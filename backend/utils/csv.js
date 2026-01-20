function parseCsv(content) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (inQuotes) {
      if (ch === '"') {
        const next = content[i + 1];
        if (next === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (ch === '\r') { /* ignore */ }
      else { field += ch; }
    }
  }
  // flush last field/row
  row.push(field);
  rows.push(row);
  // trim possible trailing empty last line
  if (rows.length && rows[rows.length - 1].every(v => v === '')) rows.pop();
  return rows;
}

function toObjects(rows) {
  if (!rows.length) return { header: [], records: [] };
  const header = rows[0].map(h => h.trim().replace(/^"|"$/g, ''));
  const records = rows.slice(1).map(cols => {
    const o = {};
    for (let i = 0; i < header.length; i++) {
      o[header[i]] = i < cols.length ? cols[i] : '';
    }
    return o;
  });
  return { header, records };
}

module.exports = { parseCsv, toObjects };

