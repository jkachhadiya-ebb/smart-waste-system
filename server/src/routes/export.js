const express = require('express');
const pool = require('../db');
const auth = require('../authMiddleware');
const PDFDocument = require('pdfkit');

const router = express.Router();

// CSV export with filters
router.get('/csv', auth, async (req, res) => {
  try {
    const startRaw = req.query.start || req.query.fromDate;
    const endRaw = req.query.end || req.query.toDate;
    const truckId = req.query.truckId;
    const metric = req.query.metric; // 'all' | 'waste' | 'co2' | 'co'

    // Default include flags
    let includeWaste = true;
    let includeCo2 = true;
    let includeCo = true;

    // If metric specified, narrow down
    if (metric && metric !== 'all') {
      includeWaste = metric === 'waste';
      includeCo2 = metric === 'co2';
      includeCo = metric === 'co';
    } else {
      // respect explicit flags if provided
      if (typeof req.query.waste !== 'undefined') {
        includeWaste = !(req.query.waste === '0' || req.query.waste === 'false');
      }
      if (typeof req.query.co2 !== 'undefined') {
        includeCo2 = !(req.query.co2 === '0' || req.query.co2 === 'false');
      }
      if (typeof req.query.co !== 'undefined') {
        includeCo = !(req.query.co === '0' || req.query.co === 'false');
      }
    }

    const selectCols = ['timestamp', 'truck_id'];
    if (includeWaste) selectCols.push('waste_kg');
    if (includeCo2) selectCols.push('co2_kg');
    if (includeCo) selectCols.push('co_kg');

    const whereParts = [];
    const params = [];

    function parseDateParam(raw, isEnd) {
      if (!raw) return null;
      const d = new Date(raw);
      if (isNaN(d)) return null;
      // If raw looks like a date-only string (YYYY-MM-DD), adjust end to end-of-day
      if (isEnd && /^\d{4}-\d{2}-\d{2}$/.test(String(raw))) {
        const d2 = new Date(d);
        d2.setDate(d2.getDate() + 1);
        d2.setMilliseconds(d2.getMilliseconds() - 1);
        return d2;
      }
      return d;
    }

    const start = parseDateParam(startRaw, false);
    const end = parseDateParam(endRaw, true);

    if (!start || !end) {
      return res.status(400).json({ message: 'Both start and end date-times are required' });
    }

    if (start > end) {
      return res.status(400).json({ message: 'Start must be before End' });
    }

    // STRICT FILTERING - Always apply date range
    whereParts.push(`timestamp BETWEEN $${params.length + 1} AND $${params.length + 2}`);
    params.push(start, end);

    // STRICT FILTERING - Apply truck filter only if specified
    if (truckId && truckId !== 'all') {
      const idNum = Number(truckId);
      if (!Number.isInteger(idNum) || idNum <= 0) {
        return res.status(400).json({ message: 'Invalid truckId' });
      }
      whereParts.push(`truck_id = $${params.length + 1}`);
      params.push(idNum);
    }

    // At least one metric must be included
    if (!includeWaste && !includeCo2 && !includeCo) {
      return res.status(400).json({ message: 'Select at least one data type' });
    }

    const whereClause = `WHERE ${whereParts.join(' AND ')}`;

    const { rows } = await pool.query(
      `SELECT ${selectCols.join(', ')} FROM telemetry ${whereClause} ORDER BY timestamp`,
      params
    );

    if (!rows || rows.length === 0) {
      return res.status(404).json({ message: 'No data found for the selected filters. Try adjusting date range or truck selection.' });
    }

    // Validate all rows match filters
    rows.forEach(r => {
      const ts = new Date(r.timestamp);
      if (ts < start || ts > end) {
        throw new Error('Data integrity error: row outside date range');
      }
      if (truckId && truckId !== 'all' && r.truck_id !== Number(truckId)) {
        throw new Error('Data integrity error: row truck mismatch');
      }
    });

    // Use semicolon by default so Excel (many locales) splits columns properly; override with ?delimiter=comma if needed
    const delimiter = req.query.delimiter === 'comma' ? ',' : ';';

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=dashboard_data.csv');

    const formatLocalTimestamp = (value) => {
      const d = new Date(value);
      if (isNaN(d)) return '';
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const hours = String(d.getHours()).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');
      const seconds = String(d.getSeconds()).padStart(2, '0');
      return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    };

    // Totals for summary row
    let totalWaste = 0;
    let totalCo2 = 0;
    let totalCo = 0;

    const header = ['Timestamp', 'Truck']
      .concat(includeWaste ? ['Waste (kg)'] : [])
      .concat(includeCo2 ? ['CO2 (kg)'] : [])
      .concat(includeCo ? ['CO (kg)'] : [])
      .join(delimiter);
    // Prepend BOM and separator hint so Excel splits columns correctly
    res.write('\ufeff');
    res.write(`sep=${delimiter}\n`);
    res.write(`${header}\n`);
    for (const r of rows) {
      const parts = [formatLocalTimestamp(r.timestamp), r.truck_id];
      if (includeWaste) {
        const v = r.waste_kg ? Number(r.waste_kg) : 0;
        totalWaste += v;
        parts.push(v);
      }
      if (includeCo2) {
        const v = r.co2_kg ? Number(r.co2_kg) : 0;
        totalCo2 += v;
        parts.push(v);
      }
      if (includeCo) {
        const v = r.co_kg ? Number(r.co_kg) : 0;
        totalCo += v;
        parts.push(v);
      }
      res.write(parts.join(delimiter) + '\n');
    }

    // Summary totals row
    const totalParts = ['TOTAL', ''];
    if (includeWaste) totalParts.push(totalWaste.toFixed(2));
    if (includeCo2) totalParts.push(totalCo2.toFixed(2));
    if (includeCo) totalParts.push(totalCo.toFixed(2));
    res.write(totalParts.join(delimiter) + '\n');
    res.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({ message: 'Internal server error' });
    }
  }
});

// PDF export with filters - apply same strict filtering
router.get('/pdf', auth, async (req, res) => {
  try {
    const startRaw = req.query.start || req.query.fromDate;
    const endRaw = req.query.end || req.query.toDate;
    const truckId = req.query.truckId;
    const metric = req.query.metric;

    let includeWaste = true;
    let includeCo2 = true;
    let includeCo = true;
    if (metric && metric !== 'all') {
      includeWaste = metric === 'waste';
      includeCo2 = metric === 'co2';
      includeCo = metric === 'co';
    } else {
      if (typeof req.query.waste !== 'undefined') {
        includeWaste = !(req.query.waste === '0' || req.query.waste === 'false');
      }
      if (typeof req.query.co2 !== 'undefined') {
        includeCo2 = !(req.query.co2 === '0' || req.query.co2 === 'false');
      }
      if (typeof req.query.co !== 'undefined') {
        includeCo = !(req.query.co === '0' || req.query.co === 'false');
      }
    }

    const selectCols = ['timestamp', 'truck_id'];
    if (includeWaste) selectCols.push('waste_kg');
    if (includeCo2) selectCols.push('co2_kg');
    if (includeCo) selectCols.push('co_kg');

    const whereParts = [];
    const params = [];

    function parseDateParam(raw, isEnd) {
      if (!raw) return null;
      const d = new Date(raw);
      if (isNaN(d)) return null;
      if (isEnd && /^\d{4}-\d{2}-\d{2}$/.test(String(raw))) {
        const d2 = new Date(d);
        d2.setDate(d2.getDate() + 1);
        d2.setMilliseconds(d2.getMilliseconds() - 1);
        return d2;
      }
      return d;
    }

    const start = parseDateParam(startRaw, false);
    const end = parseDateParam(endRaw, true);

    if (!start || !end) {
      return res.status(400).json({ message: 'Both start and end date-times are required' });
    }

    if (start > end) {
      return res.status(400).json({ message: 'Start must be before End' });
    }

    // STRICT FILTERING - Always apply date range
    whereParts.push(`timestamp BETWEEN $${params.length + 1} AND $${params.length + 2}`);
    params.push(start, end);

    if (truckId && truckId !== 'all') {
      const idNum = Number(truckId);
      if (!Number.isInteger(idNum) || idNum <= 0) {
        return res.status(400).json({ message: 'Invalid truckId' });
      }
      whereParts.push(`truck_id = $${params.length + 1}`);
      params.push(idNum);
    }

    const whereClause = `WHERE ${whereParts.join(' AND ')}`;

    const { rows } = await pool.query(
      `SELECT ${selectCols.join(', ')} FROM telemetry ${whereClause} ORDER BY timestamp`,
      params
    );

    if (!rows || rows.length === 0) {
      return res.status(404).json({ message: 'No data found for the selected period' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=dashboard_data.pdf');

    const doc = new PDFDocument({ margin: 40, bufferPages: true });
    doc.pipe(res);
    
    // Title
    doc.fontSize(20).font('Helvetica-Bold').text('Smart Waste System', { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(14).font('Helvetica').text('Dashboard Data Report', { align: 'center' });
    doc.moveDown(0.8);
    
    // Report info
    doc.fontSize(10).font('Helvetica');
    const formatLocalTimestamp = (value) => {
      const d = new Date(value);
      if (isNaN(d)) return '';
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const hours = String(d.getHours()).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');
      const seconds = String(d.getSeconds()).padStart(2, '0');
      return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    };

    const startStr = formatLocalTimestamp(start);
    const endStr = formatLocalTimestamp(end);
    doc.text(`Period: ${startStr} to ${endStr}`, { lineGap: 2 });
    doc.text(`Truck: ${truckId && truckId !== 'all' ? truckId : 'All'}`, { lineGap: 2 });
    doc.text(`Total Records: ${rows.length}`, { lineGap: 2 });
    doc.moveDown(0.6);
    
    // Calculate summary statistics
    let totalWaste = 0, totalCo2 = 0, totalCo = 0;
    rows.forEach(r => {
      if (includeWaste && r.waste_kg) totalWaste += parseFloat(r.waste_kg);
      if (includeCo2 && r.co2_kg) totalCo2 += parseFloat(r.co2_kg);
      if (includeCo && r.co_kg) totalCo += parseFloat(r.co_kg);
    });
    
    // Summary section
    doc.fontSize(11).font('Helvetica-Bold').text('Summary', { underline: true });
    doc.fontSize(10).font('Helvetica');
    if (includeWaste) doc.text(`Total Waste: ${totalWaste.toFixed(2)} kg`, { lineGap: 1 });
    if (includeCo2) doc.text(`Total CO₂: ${totalCo2.toFixed(2)} kg`, { lineGap: 1 });
    if (includeCo) doc.text(`Total CO: ${totalCo.toFixed(2)} kg`, { lineGap: 1 });
    doc.moveDown(0.8);
    
    // Table setup
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const colWidths = [];
    const numCols = 2 + (includeWaste ? 1 : 0) + (includeCo2 ? 1 : 0) + (includeCo ? 1 : 0);
    const timestampWidth = 120;
    const truckWidth = 50;
    const dataWidth = (pageWidth - timestampWidth - truckWidth) / Math.max(1, numCols - 2);
    
    colWidths.push(timestampWidth, truckWidth);
    if (includeWaste) colWidths.push(dataWidth);
    if (includeCo2) colWidths.push(dataWidth);
    if (includeCo) colWidths.push(dataWidth);
    
    // Column alignment: text columns left, numeric columns right
    const colAligns = ['left', 'left'];
    if (includeWaste) colAligns.push('right');
    if (includeCo2) colAligns.push('right');
    if (includeCo) colAligns.push('right');
    
    // Headers
    const headers = ['Timestamp', 'Truck'];
    if (includeWaste) headers.push('Waste (kg)');
    if (includeCo2) headers.push('CO₂ (kg)');
    if (includeCo) headers.push('CO (kg)');
    
    // Draw table header
    function drawTableHeader(y) {
      doc.fontSize(9).font('Helvetica-Bold');
      let x = doc.page.margins.left;
      headers.forEach((header, i) => {
        doc.text(header, x, y, { width: colWidths[i], align: colAligns[i] });
        x += colWidths[i];
      });
      doc.moveDown(0.2);
      doc.moveTo(doc.page.margins.left, doc.y)
         .lineTo(doc.page.width - doc.page.margins.right, doc.y)
         .stroke();
      doc.moveDown(0.3);
      return doc.y;
    }
    
    let currentY = drawTableHeader(doc.y);
    const pageHeight = doc.page.height;
    const bottomMargin = doc.page.margins.bottom;
    const rowHeight = 14; // approximate height per row
    
    // Draw table rows
    doc.font('Helvetica').fontSize(9);
    
    rows.forEach((r, idx) => {
      // Check if we need a new page (leave space for footer)
      const spaceNeeded = rowHeight + 4;
      if (currentY + spaceNeeded > pageHeight - bottomMargin - 25) {
        doc.addPage();
        currentY = drawTableHeader(doc.page.margins.top);
      }
      
      const timestamp = formatLocalTimestamp(r.timestamp);
      const rowData = [timestamp, `${r.truck_id}`];
      if (includeWaste) rowData.push(r.waste_kg ? parseFloat(r.waste_kg).toFixed(2) : '0.00');
      if (includeCo2) rowData.push(r.co2_kg ? parseFloat(r.co2_kg).toFixed(2) : '0.00');
      if (includeCo) rowData.push(r.co_kg ? parseFloat(r.co_kg).toFixed(2) : '0.00');
      
      let x = doc.page.margins.left;
      rowData.forEach((data, i) => {
        doc.text(String(data), x, currentY, { width: colWidths[i], align: colAligns[i] });
        x += colWidths[i];
      });
      
      currentY += rowHeight;
      
      // Add subtle line every 10 rows for readability
      if ((idx + 1) % 10 === 0) {
        doc.moveTo(doc.page.margins.left, currentY - 2)
           .lineTo(doc.page.width - doc.page.margins.right, currentY - 2)
           .strokeOpacity(0.15)
           .stroke()
           .strokeOpacity(1);
      }
    });
    
    // Add footers BEFORE ending document (with bufferPages enabled)
    const pageCount = doc.bufferedPageRange().count;
    // Draw footers inside the page content area to avoid pdfkit auto-adding blank pages
    const footerLineHeight = doc.fontSize(8).font('Helvetica').currentLineHeight(true);
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      const footerY = doc.page.height - doc.page.margins.bottom - footerLineHeight;
      doc.text(
        `Page ${i + 1} of ${pageCount}`,
        doc.page.margins.left,
        footerY,
        { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, align: 'center' }
      );
    }

    // End document after all content and footers are complete
    doc.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({ message: 'Internal server error' });
    }
  }
});

module.exports = router;
