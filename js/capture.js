/**
 * צילום העלון לתמונה אנכית בסגנון טלפון (כמו תצוגת מובייל).
 */

const PHONE_WIDTH = 390;

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
  const wrap = sheet.closest('.page-wrap');

  const prevSheet = {
    width: sheet.style.width,
    height: sheet.style.height,
    maxHeight: sheet.style.maxHeight,
    minHeight: sheet.style.minHeight,
    transform: sheet.style.transform,
    u: sheet.style.getPropertyValue('--u'),
  };
  const prevWrap = wrap
    ? { width: wrap.style.width, margin: wrap.style.margin, maxWidth: wrap.style.maxWidth }
    : null;

  document.body.classList.add('capture-print', 'capture-phone');

  try {
    await document.fonts?.ready?.catch?.(() => {});

    if (wrap) {
      wrap.style.width = `${PHONE_WIDTH}px`;
      wrap.style.maxWidth = `${PHONE_WIDTH}px`;
      wrap.style.margin = '0';
    }

    // פריסת טלפון: גובה לפי תוכן, ובגודל טקסט מלא (בלי הקטנת ההתאמה לעמוד)
    sheet.style.width = `${PHONE_WIDTH}px`;
    sheet.style.height = 'auto';
    sheet.style.maxHeight = 'none';
    sheet.style.minHeight = '0';
    sheet.style.transform = 'none';
    sheet.style.setProperty('--u', '1');

    await waitFrames(3);

    const w = PHONE_WIDTH;
    const h = Math.max(1, Math.ceil(sheet.scrollHeight));
    sheet.style.height = `${h}px`;

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
        doc.body.classList.add('capture-print', 'capture-phone');
        const clonedWrap = doc.querySelector('.page-wrap');
        const cloned = doc.querySelector('.sheet');
        if (clonedWrap) {
          clonedWrap.style.width = `${w}px`;
          clonedWrap.style.maxWidth = `${w}px`;
          clonedWrap.style.margin = '0';
        }
        if (cloned) {
          cloned.style.width = `${w}px`;
          cloned.style.height = `${h}px`;
          cloned.style.maxHeight = 'none';
          cloned.style.minHeight = '0';
          cloned.style.transform = 'none';
          cloned.style.boxShadow = 'none';
          cloned.style.border = 'none';
          cloned.style.setProperty('--u', '1');
        }
        doc
          .querySelectorAll(
            '.source-note, .msg-remove, .msg-tools, .lesson-head-tools, .lesson-del, .lesson-add, .lesson-add-block, .toolbar, .edit-panel',
          )
          .forEach((el) => {
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
    sheet.style.width = prevSheet.width;
    sheet.style.height = prevSheet.height;
    sheet.style.maxHeight = prevSheet.maxHeight;
    sheet.style.minHeight = prevSheet.minHeight;
    sheet.style.transform = prevSheet.transform;
    if (prevSheet.u) sheet.style.setProperty('--u', prevSheet.u);
    else sheet.style.removeProperty('--u');
    if (wrap && prevWrap) {
      wrap.style.width = prevWrap.width;
      wrap.style.margin = prevWrap.margin;
      wrap.style.maxWidth = prevWrap.maxWidth;
    }
    document.body.classList.remove('capture-print', 'capture-phone');
  }
}
