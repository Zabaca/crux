export function priorityRank(tier: string | null | undefined): number {
  switch (tier) {
    case "P0":
      return 0;
    case "P1":
      return 1;
    case "P2":
      return 2;
    case "P3":
      return 3;
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
