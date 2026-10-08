function escapeCsvCell(value) {
  if (value == null || value === '') {
    return '';
  }
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function formatAmountForCsv(amount) {
  if (amount == null || Number.isNaN(Number(amount))) {
    return '';
  }
  return Number(amount).toFixed(2);
}

function buildPayrollCsv({ items, summary, startDate, endDate }) {
  const header = [
    'Employee Name',
    'Employee Email',
    'Date',
    'Shift',
    'Amount (INR)',
    'Day Total (INR)',
  ];
  const lines = [header.map(escapeCsvCell).join(',')];

  for (const item of items) {
    const name = item.employee?.name ?? '';
    const email = item.employee?.email ?? '';
    const dayTotal = formatAmountForCsv(item.dayTotal);

    if (!item.shifts?.length) {
      lines.push(
        [name, email, item.date, '', '', dayTotal].map(escapeCsvCell).join(',')
      );
      continue;
    }

    for (const shift of item.shifts) {
      lines.push(
        [
          name,
          email,
          item.date,
          shift.shiftLabel,
          formatAmountForCsv(shift.amount),
          dayTotal,
        ]
          .map(escapeCsvCell)
          .join(',')
      );
    }
  }

  lines.push('');
  lines.push(
    ['Report period', `${startDate} to ${endDate}`, '', '', '', ''].map(escapeCsvCell).join(',')
  );
  if (summary) {
    lines.push(
      ['Grand total (INR)', formatAmountForCsv(summary.grandTotal), '', '', '', ''].map(
        escapeCsvCell
      ).join(',')
    );
    lines.push(
      ['Marked days', summary.recordCount ?? '', '', '', '', ''].map(escapeCsvCell).join(',')
    );
    lines.push(
      ['Confirmed shifts', summary.markedShiftCount ?? '', '', '', '', ''].map(escapeCsvCell).join(
        ','
      )
    );
  }

  return `\uFEFF${lines.join('\r\n')}`;
}

module.exports = { buildPayrollCsv };
