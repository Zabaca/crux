export function statusRank(status: string | null | undefined): number {
  switch (status) {
    case "now":
      return 0;
    case "next":
      return 1;
    case "later":
      return 2;
    case null:
    case undefined:
      return 3;
    case "done":
      return 4;
    case "abandoned":
      return 5;
    default:
      return 99;
  }
}

export function solutionStatusRank(status: string): number {
  switch (status) {
    case "chosen":
      return 0;
    case "shipped":
      return 1;
    case "evaluated":
      return 2;
    case "proposed":
      return 3;
    case "rejected":
      return 4;
    default:
      return 99;
  }
}
