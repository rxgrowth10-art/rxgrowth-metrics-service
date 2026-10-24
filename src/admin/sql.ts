export function statementsFromSql(source: string): string[] {
  const withoutComments = source
    .split(/\r?\n/)
    .filter((line) => !/^\s*--/.test(line))
    .join("\n");
  return withoutComments
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}
