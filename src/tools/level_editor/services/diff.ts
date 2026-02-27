export function createUnifiedLineDiff(before: string, after: string): string {
  if (before === after) {
    return "No changes.";
  }

  const beforeLines = before.replace(/\r\n/g, "\n").split("\n");
  const afterLines = after.replace(/\r\n/g, "\n").split("\n");
  const lcs = buildLcsMatrix(beforeLines, afterLines);
  const diffLines: string[] = ["--- original", "+++ current"];

  let i = beforeLines.length;
  let j = afterLines.length;
  const body: string[] = [];

  while (i > 0 && j > 0) {
    if (beforeLines[i - 1] === afterLines[j - 1]) {
      body.push(` ${beforeLines[i - 1]}`);
      i -= 1;
      j -= 1;
      continue;
    }

    if (lcs[i - 1][j] >= lcs[i][j - 1]) {
      body.push(`-${beforeLines[i - 1]}`);
      i -= 1;
    } else {
      body.push(`+${afterLines[j - 1]}`);
      j -= 1;
    }
  }

  while (i > 0) {
    body.push(`-${beforeLines[i - 1]}`);
    i -= 1;
  }

  while (j > 0) {
    body.push(`+${afterLines[j - 1]}`);
    j -= 1;
  }

  body.reverse();
  diffLines.push(...body);
  return diffLines.join("\n");
}

function buildLcsMatrix(left: string[], right: string[]): number[][] {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      if (left[i - 1] === right[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1] + 1;
      } else {
        matrix[i][j] = Math.max(matrix[i - 1][j], matrix[i][j - 1]);
      }
    }
  }

  return matrix;
}
