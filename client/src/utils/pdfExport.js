import domtoimage from 'dom-to-image-more';
import { jsPDF } from 'jspdf';
import toast from 'react-hot-toast';

/**
 * Apply layout optimizations to the clone so that it fits
 * the target page orientation (Landscape or Portrait) edge-to-edge
 * without excessive empty white borders.
 */
function applyOrientationStyles(clone, isLandscape) {
  if (isLandscape) {
    // ── Landscape Mode: Wide horizontal proportions ──
    clone.style.width = '1440px';
    clone.style.minWidth = '1440px';
    clone.style.maxWidth = '1440px';

    // Header cells (University, Department)
    const uniHeader = clone.querySelector('th.bg-blue-900.text-white');
    if (uniHeader) {
      uniHeader.style.padding = '4px 8px';
      uniHeader.style.fontSize = '16px';
    }
    const deptHeader = clone.querySelector('th.bg-blue-800.text-white');
    if (deptHeader) {
      deptHeader.style.padding = '3px 8px';
      deptHeader.style.fontSize = '12px';
    }

    // Time slot headers
    clone.querySelectorAll('th.bg-blue-700').forEach((th) => {
      th.style.padding = '3px 4px';
      th.style.fontSize = '10.5px';
    });

    // Day & Yr-Sm headers & cells
    clone.querySelectorAll('th.w-14, th.w-24, td.bg-blue-900, td.font-bold').forEach((el) => {
      el.style.padding = '2px 4px';
      el.style.fontSize = '11px';
    });

    // Routine slot cells — make compact so height balances the width
    clone.querySelectorAll('div.h-14, div[draggable="true"]').forEach((cell) => {
      cell.style.height = '32px';
      cell.style.minHeight = '32px';
      cell.style.maxHeight = '32px';
      cell.style.padding = '1px 3px';
      cell.style.gap = '2px';
    });

    // Inner text in cells
    clone.querySelectorAll('div[draggable="true"] span').forEach((span) => {
      span.style.fontSize = '9.5px';
      span.style.lineHeight = '1.1';
    });

    // Empty cell spacers
    clone.querySelectorAll('td > div:empty').forEach((emptyDiv) => {
      emptyDiv.style.height = '32px';
      emptyDiv.style.minHeight = '32px';
    });

    // Break column
    clone.querySelectorAll('td.bg-yellow-300').forEach((breakCol) => {
      breakCol.style.padding = '2px';
      breakCol.style.fontSize = '10px';
    });

    // Teacher legend
    const legendContainer = clone.querySelector('.border-t.border-slate-300');
    if (legendContainer) {
      legendContainer.style.padding = '4px 10px';
    }
    const legendHeading = legendContainer?.querySelector('h3');
    if (legendHeading) {
      legendHeading.style.marginBottom = '2px';
      legendHeading.style.fontSize = '11px';
    }
    legendContainer?.querySelectorAll('th, td').forEach((cell) => {
      cell.style.padding = '2px 4px';
      cell.style.fontSize = '9px';
      cell.style.lineHeight = '1.15';
    });
  } else {
    // ── Portrait Mode: Tall vertical proportions ──
    clone.style.width = '1000px';
    clone.style.minWidth = '1000px';
    clone.style.maxWidth = '1000px';

    // Slightly compact cells to fit single page vertically
    clone.querySelectorAll('div.h-14, div[draggable="true"]').forEach((cell) => {
      cell.style.height = '42px';
      cell.style.minHeight = '42px';
      cell.style.maxHeight = '42px';
      cell.style.padding = '2px 3px';
    });

    clone.querySelectorAll('td > div:empty').forEach((emptyDiv) => {
      emptyDiv.style.height = '42px';
      emptyDiv.style.minHeight = '42px';
    });

    const legendContainer = clone.querySelector('.border-t.border-slate-300');
    if (legendContainer) {
      legendContainer.style.padding = '6px 12px';
    }
    legendContainer?.querySelectorAll('th, td').forEach((cell) => {
      cell.style.padding = '2.5px 4px';
      cell.style.fontSize = '9.5px';
    });
  }
}

/**
 * Export the rendered routine timetable as a high-definition PDF
 * in either Landscape or Portrait mode.
 *
 * @param {Object} options
 * @param {'landscape'|'portrait'} [options.orientation='landscape']
 * @param {string} [options.filename='routine.pdf']
 * @param {string} [options.targetId='routine-capture-target']
 * @param {string} [options.fallbackId='routine-pdf-container']
 * @returns {Promise<void>}
 */
export async function exportRoutineToPdf({
  orientation = 'landscape',
  filename = 'routine.pdf',
  targetId = 'routine-capture-target',
  fallbackId = 'routine-pdf-container',
} = {}) {
  const isLandscape = orientation === 'landscape';
  const modeLabel = isLandscape ? 'Landscape' : 'Portrait';
  const toastId = toast.loading(`Generating ${modeLabel} PDF (please wait a moment)...`);

  try {
    const element = document.getElementById(targetId) || document.getElementById(fallbackId);
    if (!element) {
      throw new Error('Could not find the routine schedule container.');
    }

    // Dimensions for Legal paper (in points: 1 pt = 1/72 inch)
    // Landscape: 14" width x 8.5" height (1008 pt x 612 pt)
    // Portrait:  8.5" width x 14" height (612 pt x 1008 pt)
    const pdfWidth = isLandscape ? 1008 : 612;
    const pdfHeight = isLandscape ? 612 : 1008;
    const margin = 14; // Clean, professional 0.2-inch margin

    const maxWidth = pdfWidth - margin * 2;
    const maxHeight = pdfHeight - margin * 2;
    const targetPaperRatio = maxWidth / maxHeight; // ~1.678 for Legal Landscape

    // Clone the element offscreen to capture at full natural scale with zero scrollbars
    const clone = element.cloneNode(true);
    clone.style.transform = 'none';
    clone.style.height = 'auto';
    clone.style.overflow = 'visible';
    clone.style.position = 'fixed';
    clone.style.top = '-99999px';
    clone.style.left = '-99999px';
    clone.style.zIndex = '-9999';
    clone.style.background = '#ffffff';

    // Apply orientation-specific geometry
    applyOrientationStyles(clone, isLandscape);

    // Ensure zero scrollbars or overflow clipping on all children
    clone.querySelectorAll('*').forEach((el) => {
      el.style.overflow = 'visible';
    });

    document.body.appendChild(clone);
    await new Promise((r) => setTimeout(r, 80));

    // Dynamically calculate width so the routine aspect ratio
    // matches the Legal Landscape paper proportions (14" : 8.5") perfectly.
    // This allows the table columns to expand edge-to-edge across the paper.
    if (isLandscape) {
      const renderedHeight = clone.scrollHeight || 950;
      const optimalWidth = Math.max(1650, Math.round(renderedHeight * targetPaperRatio));
      clone.style.width = `${optimalWidth}px`;
      clone.style.minWidth = `${optimalWidth}px`;
      clone.style.maxWidth = `${optimalWidth}px`;
      await new Promise((r) => setTimeout(r, 80));
    }

    const captureWidth = clone.scrollWidth || (isLandscape ? 1750 : 1000);
    const captureHeight = clone.scrollHeight || 800;

    const scale = 2; // HD scale factor for ultra-crisp text
    const style = {
      transform: `scale(${scale})`,
      transformOrigin: 'top left',
      width: `${captureWidth}px`,
      height: `${captureHeight}px`,
      overflow: 'visible',
    };

    let imgData;
    try {
      imgData = await domtoimage.toJpeg(clone, {
        width: captureWidth * scale,
        height: captureHeight * scale,
        quality: 0.98,
        bgcolor: '#ffffff',
        filter: (node) => {
          if (node.getAttribute && node.getAttribute('data-pdf-exclude') === 'true') return false;
          if (node.classList && node.classList.contains('routine-zoom-toolbar')) return false;
          return true;
        },
        style,
      });
    } finally {
      if (clone && clone.parentNode) {
        clone.parentNode.removeChild(clone);
      }
    }

    const img = new Image();
    img.src = imgData;
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('Failed to render routine snapshot.'));
    });

    let printWidth = img.width;
    let printHeight = img.height;
    const ratio = printWidth / printHeight;
    const maxRatio = maxWidth / maxHeight;

    if (ratio > maxRatio) {
      printWidth = maxWidth;
      printHeight = maxWidth / ratio;
    } else {
      printHeight = maxHeight;
      printWidth = maxHeight * ratio;
    }

    const x = (pdfWidth - printWidth) / 2;
    const y = (pdfHeight - printHeight) / 2;

    const pdf = new jsPDF({
      orientation: isLandscape ? 'landscape' : 'portrait',
      unit: 'pt',
      format: 'legal',
    });

    pdf.addImage(imgData, 'JPEG', x, y, printWidth, printHeight);

    // Format clean output filename
    let finalName = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
    if (!finalName.toLowerCase().includes(orientation)) {
      finalName = finalName.replace(/\.pdf$/i, `_${orientation}.pdf`);
    }

    pdf.save(finalName);
    toast.success(`Downloaded ${modeLabel} PDF successfully!`, { id: toastId });
  } catch (err) {
    console.error('PDF Export Error:', err);
    toast.error(`Error: ${err.message || 'Failed to generate PDF.'}`, {
      id: toastId,
      duration: 6000,
    });
    throw err;
  }
}
