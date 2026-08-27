/**
 * Outbound email — one message shape, one transport, and the messages the
 * deployment actually sends.
 *
 * The Worker sends email for exactly one reason: a magic link is the only way a
 * browser session is ever created (ADR-0007). That makes the sender a hard
 * dependency of signing in rather than a nice-to-have, which is why it is a
 * parameter of `createAuth` and not something a call site reaches for globally
 * — a test passes a capturing sender and never touches the network.
 *
 * `EmailSender` is a function, not a class, because the only thing any caller
 * needs is "deliver this message or throw". Swapping Resend for anything else
 * is a new function, not a new interface.
 *
 * No SDK: Resend's send endpoint is one POST with a JSON body, and the `resend`
 * package pulls React-email rendering into a Worker bundle that has no use for
 * it. `fetch` is already global in workerd.
 */

/** A message ready to send. `text` is not optional — a link-only HTML mail with no
 * plain-text alternative is what spam filters are built to catch. */
export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

/** Deliver a message, or throw. */
export type EmailSender = (message: EmailMessage) => Promise<void>;

/** Delivery failed. Carries no address: this is rendered to whoever is signing in. */
export class EmailSendError extends Error {
  readonly code = "EMAIL_SEND_FAILED";
  constructor(message: string) {
    super(message);
    this.name = "EmailSendError";
  }
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * A sender backed by Resend.
 *
 * `from` must be an address on a domain verified in the Resend account the key
 * belongs to; Resend answers 403 otherwise, which surfaces here as a thrown
 * `EmailSendError` rather than a silently unsent link.
 */
export function resendSender(opts: { apiKey: string; from: string }): EmailSender {
  return async (message) => {
    let response: Response;
    try {
      response = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${opts.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: opts.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
      });
    } catch (cause) {
      throw new EmailSendError(`could not reach Resend: ${String(cause)}`);
    }

    if (!response.ok) {
      // Resend puts the useful part in a JSON `message`; fall back to the body.
      const body = await response.text();
      let detail = body;
      try {
        const parsed = JSON.parse(body) as { message?: string };
        if (parsed.message) detail = parsed.message;
      } catch {
        // Not JSON — the raw body is the best detail available.
      }
      throw new EmailSendError(`Resend refused the message (${response.status}): ${detail}`);
    }
  };
}

/** HTML-escape a value interpolated into an email body. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The sign-in link message.
 *
 * Deliberately plain: no logo, no tracking pixel, no button image. A link that
 * mints a session is exactly the shape a phishing mail imitates, so the mail
 * says which Workspace it is for, how long it lasts, and what to do if it was
 * not requested — and shows the URL as text so it can be read before it is
 * clicked.
 */
export function magicLinkEmail(opts: {
  url: string;
  workspace: string;
  expiresInMinutes: number;
}): Omit<EmailMessage, "to"> {
  const { url, workspace, expiresInMinutes } = opts;
  const subject = `Sign in to ${workspace}`;
  const text = [
    `Sign in to ${workspace}`,
    "",
    "Open this link to sign in:",
    url,
    "",
    `The link expires in ${expiresInMinutes} minutes and can be used once.`,
    "If you did not ask to sign in, ignore this message — nothing happens until the link is opened.",
  ].join("\n");

  const safeUrl = escapeHtml(url);
  const safeWorkspace = escapeHtml(workspace);
  const html = `<!doctype html>
<html lang="en">
<body style="margin:0;padding:32px 16px;background:#f6f6f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1a1a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e5e5e5;border-radius:8px;">
        <tr><td style="padding:32px;font-size:15px;line-height:1.6;">
          <h1 style="margin:0 0 16px;font-size:18px;font-weight:600;">Sign in to ${safeWorkspace}</h1>
          <p style="margin:0 0 24px;">Open this link to sign in:</p>
          <p style="margin:0 0 24px;">
            <a href="${safeUrl}" style="display:inline-block;padding:10px 18px;background:#1a1a1a;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:500;">Sign in</a>
          </p>
          <p style="margin:0 0 24px;font-size:13px;color:#666;word-break:break-all;">${safeUrl}</p>
          <p style="margin:0 0 8px;font-size:13px;color:#666;">
            The link expires in ${expiresInMinutes} minutes and can be used once.
          </p>
          <p style="margin:0;font-size:13px;color:#666;">
            If you did not ask to sign in, ignore this message — nothing happens until the link is opened.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}
