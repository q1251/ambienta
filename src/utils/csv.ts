export function parseCsvRows(csvText: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let closedQuote = false;
  const input = csvText.replace(/^\uFEFF/, '');

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (inQuotes) {
      if (character === '"' && input[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        inQuotes = false;
        closedQuote = true;
      } else {
        cell += character;
      }
      continue;
    }

    if (character === '"' && cell.trim() === '' && !closedQuote) {
      cell = '';
      inQuotes = true;
    } else if (character === ',' || character === '\n' || character === '\r') {
      row.push(cell.trim());
      cell = '';
      closedQuote = false;
      if (character !== ',') {
        if (row.some((value) => value !== '')) rows.push(row);
        row = [];
        if (character === '\r' && input[index + 1] === '\n') index += 1;
      }
    } else {
      if (closedQuote && character.trim() !== '') {
        throw new Error('CSV contains unexpected characters after a quoted value.');
      }
      cell += character;
    }
  }

  if (inQuotes) throw new Error('CSV contains an unclosed quoted value.');
  row.push(cell.trim());
  if (row.some((value) => value !== '')) rows.push(row);
  return rows;
}
