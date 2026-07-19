/**
 * צילום העלון לתמונה — html2canvas כברירת מחדל (יציב יותר מול פונטים/mm).
 */

function waitFrames(n = 2) {
  return new Promise((resolve) => {
    const step = () => {
      if (n-- <= 0) resolve();
      else requestAnimationFrame(step);
    };
    step();
  });
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`טעינת ספרייה נכשלה: ${src}`));
    document.head.appendChild(s);
  });
}

async function ensureHtml2Canvas() {
  if (typeof window.html2canvas === 'function') return window.html2canvas;
  await loadScript('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js');
  if (typeof window.html2canvas !== 'function') {
    throw new Error('html2canvas לא זמין');
  }
  return window.html2canvas;
}

/**
 * @param {HTMLElement} sheet
 * @returns {Promise<Blob>}
 */
export async function captureSheetToPng(sheet) {
  if (!sheet) throw new Error('לא נמצא עלון לצילום');

  const html2canvas = await ensureHtml2Canvas();
  document.body.classList.add('capture-print');

  // html2canvas מתקשה עם יחידות mm — מעבירים לפיקסלים זמנית
  const prev = {
    width: sheet.style.width,
    height: sheet.style.height,
    maxHeight: sheet.style.maxHeight,
    minHeight: sheet.style.minHeight,
    transform: sheet.style.transform,
  };

  try {
    await document.fonts?.ready?.catch?.(() => {});
    await waitFrames(2);

    const rect = sheet.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    sheet.style.width = `${w}px`;
    sheet.style.height = `${h}px`;
    sheet.style.maxHeight = `${h}px`;
    sheet.style.minHeight = `${h}px`;
    sheet.style.transform = 'none';

    await waitFrames(2);

    const canvas = await html2canvas(sheet, {
      scale: 2,
      useCORS: true,
      allowTaint: false,
      backgroundColor: '#ffffff',
      logging: false,
      imageTimeout: 8000,
      width: w,
      height: h,
      windowWidth: w,
      windowHeight: h,
      scrollX: 0,
      scrollY: -window.scrollY,
      x: 0,
      y: 0,
      onclone: (doc) => {
        const cloned = doc.querySelector('.sheet');
        if (!cloned) return;
        cloned.style.width = `${w}px`;
        cloned.style.height = `${h}px`;
        cloned.style.maxHeight = `${h}px`;
        cloned.style.minHeight = `${h}px`;
        cloned.style.transform = 'none';
        cloned.style.boxShadow = 'none';
        cloned.style.border = 'none';
        // הסתרת הערות מקור גם בעותק
        doc.querySelectorAll('.source-note, .msg-remove').forEach((el) => {
          el.style.display = 'none';
        });
      },
    });

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('toBlob החזיר ריק'))),
        'image/png',
        1,
      );
    });

    if (!blob || blob.size < 1000) {
      throw new Error('התמונה שנוצרה ריקה או קטנה מדי');
    }
    return blob;
  } finally {
    sheet.style.width = prev.width;
    sheet.style.height = prev.height;
    sheet.style.maxHeight = prev.maxHeight;
    sheet.style.minHeight = prev.minHeight;
    sheet.style.transform = prev.transform;
    document.body.classList.remove('capture-print');
  }
}
