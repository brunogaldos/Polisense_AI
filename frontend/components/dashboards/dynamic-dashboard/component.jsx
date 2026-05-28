import React, { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useDashboard } from 'contexts/DashboardContext';
import { downloadDocument } from 'services/research-api';

// Mermaid CDN — loaded once per session
const MERMAID_CDN = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';

/**
 * Initialise (or re-initialise) Mermaid on all .mermaid elements inside a container.
 * Safe to call multiple times; loads the CDN script only once.
 */
async function initMermaid(container) {
  if (!container) return;
  const nodes = container.querySelectorAll('.mermaid');
  if (!nodes.length) return;

  const load = () =>
    new Promise(resolve => {
      if (window.mermaid) { resolve(window.mermaid); return; }
      const s = document.createElement('script');
      s.src = MERMAID_CDN;
      s.onload = () => resolve(window.mermaid);
      s.onerror = () => resolve(null);
      document.head.appendChild(s);
    });

  const mermaid = await load();
  if (!mermaid) return;

  // Reset every node to its original definition so re-renders work
  nodes.forEach(node => {
    if (node.dataset.processed) {
      // Restore original code from data attribute before re-running
      const original = node.dataset.mermaidCode;
      if (original) {
        node.innerHTML = original;
        delete node.dataset.processed;
      }
    } else {
      // Save original code for potential re-renders
      node.dataset.mermaidCode = node.textContent.trim();
    }
  });

  try {
    mermaid.initialize({
      startOnLoad: false,
      theme: 'default',
      themeVariables: {
        primaryColor: '#2c7bb6',
        primaryTextColor: '#1a1a1a',
        primaryBorderColor: '#1a5f8c',
        lineColor: '#555',
        secondaryColor: '#e8f4f8',
        tertiaryColor: '#f0f0f0'
      },
      flowchart: { useMaxWidth: true, htmlLabels: true },
      pie: { useWidth: 500 }
    });
    await mermaid.run({ nodes: Array.from(nodes) });
  } catch (err) {
    console.warn('⚠️ Mermaid render error:', err);
  }
}

/**
 * Dynamic Dashboard Component
 * Renders AI-generated reports including inline SVG charts and Mermaid diagrams.
 */
const DynamicDashboard = ({ dashboardData, className = '' }) => {
  const contentRef = useRef(null);
  // Separate ref for doc-link rewriting so it works in BOTH the Gemini and the
  // fallback plain-text rendering paths (mermaid only runs on Gemini).
  const reportTextRef = useRef(null);
  const { memoryId, uploadedDocuments } = useDashboard();

  if (!dashboardData || dashboardData.type !== 'dashboard') {
    return (
      <div className={`c-report-canvas ${className}`}>
        <div className="c-report-canvas__error">
          <h3>❌ Unable to generate report</h3>
          <p>Please try creating a new report from a chatbot response.</p>
        </div>
      </div>
    );
  }

  // Extract report content from the dashboard data
  const getReportContent = () => {
    const geminiSection = dashboardData.sections.find(section => section.type === 'gemini_report');
    if (geminiSection) {
      return {
        content: geminiSection.data.content,
        source: geminiSection.data.source,
        generatedAt: geminiSection.data.generatedAt,
        isGemini: true
      };
    }
    const textSection = dashboardData.sections.find(section => section.type === 'text_content');
    if (textSection) {
      return {
        content: textSection.data.content,
        source: dashboardData.metadata?.source || 'Fallback',
        generatedAt: dashboardData.metadata?.generatedAt,
        isGemini: false
      };
    }
    return null;
  };

  const reportData = getReportContent();

  if (!reportData) {
    return (
      <div className={`c-report-canvas ${className}`}>
        <div className="c-report-canvas__error">
          <h3>❌ No report content found</h3>
          <p>Please try creating a new report from a chatbot response.</p>
        </div>
      </div>
    );
  }

  // Detect HTML vs Markdown and strip any injected <style> blocks
  const extractContentParts = (content) => {
    if (!content || typeof content !== 'string') {
      return { mainContent: '', isHTML: false };
    }
    let mainContent = content.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').trim();

    const hasHTMLTags = /<[a-z][\s\S]*>/i.test(mainContent);
    const hasMarkdownSyntax =
      /^#{1,6}\s/.test(mainContent) ||
      /\*\*[^*]+\*\*/.test(mainContent) ||
      /^\d+\.\s/.test(mainContent) ||
      /^-\s/.test(mainContent) ||
      /^\*\s/.test(mainContent);

    const isHTML = hasHTMLTags && !hasMarkdownSyntax;

    if (isHTML) {
      mainContent = mainContent
        .replace(/^<div[^>]*>/i, '')
        .replace(/<\/div>$/i, '')
        .trim();
    }

    return { mainContent, isHTML };
  };

  const { mainContent, isHTML } = extractContentParts(reportData.content);

  // ── Mermaid initialisation after every render ──────────────────────────────
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (reportData.isGemini && isHTML && contentRef.current) {
      // Small delay to ensure dangerouslySetInnerHTML has painted
      const timer = setTimeout(() => initMermaid(contentRef.current), 100);
      return () => clearTimeout(timer);
    }
  }, [mainContent, isHTML, reportData.isGemini]);

  // ── Rewrite uploaded-document mentions inside the References section ──────
  // Only the "References" section gets its document-name mentions turned into
  // clickable download links — not the body of the report. Two reasons:
  //   1. Inline mentions ("see Report v2.pdf") often refer to the document in
  //      a narrative way, not as a citation that should be downloaded.
  //   2. Limiting to References keeps the rewriting predictable and avoids
  //      surprising users with auto-links in the middle of prose.
  //
  // We detect the section by heading text (English "References", Spanish
  // "Referencias", with optional trailing punctuation/colon) and rewrite text
  // nodes from that heading's next siblings until the next heading at the
  // same or higher level (or end of container).
  //
  // Why DOM walking and not string substitution on `mainContent`: the report
  // can be either HTML (dangerouslySetInnerHTML) or markdown (ReactMarkdown).
  // Post-render DOM rewriting handles both uniformly and never breaks
  // existing anchor/heading structure.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    const container = reportTextRef.current;
    if (!container || !memoryId || !uploadedDocuments?.length) return;

    const docsForLink = uploadedDocuments.filter((d) => d && d.name && d.id);
    if (docsForLink.length === 0) return;

    const REFERENCES_HEADING =
      /^\s*(references?|referencias?|bibliograf[ií]a|sources?|fuentes?|works\s+cited|bibliography)\s*[:：]?\s*$/i;

    const timer = setTimeout(() => {
      // Already injected — don't duplicate on re-render.
      if (container.querySelector('[data-ref-doc-link]')) return;

      // 1. Find the References heading.
      const headings = Array.from(container.querySelectorAll('h1, h2, h3, h4, h5, h6'));
      const refHeading = headings.find((h) =>
        REFERENCES_HEADING.test((h.textContent || '').trim()),
      );
      if (!refHeading) return;

      // 2. Collect the section's immediate children until the next equal/higher heading.
      const stopLevel = parseInt(refHeading.tagName.slice(1), 10) || 2;
      const sectionRoots = [];
      for (let sib = refHeading.nextElementSibling; sib; sib = sib.nextElementSibling) {
        const tag = sib.tagName;
        if (/^H[1-6]$/.test(tag) && parseInt(tag.slice(1), 10) <= stopLevel) break;
        sectionRoots.push(sib);
      }

      // 3. Strip out the AI's vector-store-name mentions for each uploaded doc.
      //    The backend uploads e.g. `parcelas.geojson` to the vector store as
      //    `parcelas_features.txt` — the AI then writes that ".txt" name in
      //    the references. Drop any list item / paragraph that mentions a
      //    `{basename}_features.txt`, `{basename}.txt`, or `{basename}.json`
      //    variant of an uploaded GeoJSON/JSON. Replaced by the hyperlink below.
      const stripVariants = new Set();
      docsForLink.forEach((doc) => {
        const baseName = doc.name.replace(/\.[^.]+$/, '');
        const lowerOriginal = doc.name.toLowerCase();
        // Only strip variants whose extension differs from the original — never
        // remove a list item that literally matches the original filename, in
        // case the AI got it right.
        ['_features.txt', '.txt'].forEach((suffix) => {
          const variant = `${baseName}${suffix}`.toLowerCase();
          if (variant !== lowerOriginal) stripVariants.add(variant);
        });
      });
      if (stripVariants.size > 0) {
        sectionRoots.forEach((root) => {
          // Match <li> first (typical references list), fall back to <p>.
          const candidates = root.matches?.('li, p')
            ? [root]
            : Array.from(root.querySelectorAll('li, p'));
          candidates.forEach((el) => {
            const text = (el.textContent || '').toLowerCase();
            for (const variant of stripVariants) {
              if (text.includes(variant)) {
                el.remove();
                break;
              }
            }
          });
        });
      }

      // 4. Re-collect section roots after possible removals.
      const liveSectionRoots = sectionRoots.filter((el) => el.isConnected);

      // 5. Find an existing <ul>/<ol> to append to, or create one after the last element.
      const existingList = liveSectionRoots.find((el) => el.tagName === 'UL' || el.tagName === 'OL');
      const anchorParent = existingList || (() => {
        const ul = document.createElement('ul');
        ul.style.paddingLeft = '1.5em';
        const insertAfter = liveSectionRoots.length > 0
          ? liveSectionRoots[liveSectionRoots.length - 1]
          : refHeading;
        insertAfter.parentNode.insertBefore(ul, insertAfter.nextSibling);
        return ul;
      })();

      // 6. Append one <li><a> per uploaded document.
      //    Use the original filename from uploadedDocuments — never the AI-generated text —
      //    so names are always correct regardless of what the vector store called the file.
      docsForLink.forEach((doc) => {
        const li = document.createElement('li');
        li.setAttribute('data-ref-doc-link', doc.id);
        const a = document.createElement('a');
        a.href = '#';
        a.textContent = doc.name;
        a.setAttribute('data-doc-id', doc.id);
        a.setAttribute('data-doc-name', doc.name);
        a.className = 'c-report-canvas__doc-link';
        a.style.color = '#0066cc';
        a.style.textDecoration = 'underline';
        a.style.cursor = 'pointer';
        li.appendChild(a);
        anchorParent.appendChild(li);
      });
    }, 150);

    const onClick = (e) => {
      const link = e.target.closest('a[data-doc-id]');
      if (!link || !container.contains(link)) return;
      e.preventDefault();
      const docId = link.getAttribute('data-doc-id');
      const docName = link.getAttribute('data-doc-name');
      if (!docId || !docName) return;
      downloadDocument(memoryId, docId, docName).catch((err) => {
        console.warn('Doc-link download failed:', err);
        const msg = err?.response?.data?.error || err?.message || 'Could not download this file.';
        const note = document.createElement('span');
        note.style.color = '#cc0000';
        note.style.marginLeft = '6px';
        note.style.fontSize = '0.85em';
        note.textContent = ` (download failed: ${msg})`;
        link.parentNode.insertBefore(note, link.nextSibling);
        setTimeout(() => note.remove(), 6000);
      });
    };
    container.addEventListener('click', onClick);
    return () => {
      clearTimeout(timer);
      container.removeEventListener('click', onClick);
    };
  }, [mainContent, isHTML, memoryId, uploadedDocuments]);

  // ── PDF print handler ──────────────────────────────────────────────────────
  const handlePrint = () => {
    const reportTitle = dashboardData.title || 'POLISENSE.AI REPORT';
    const generatedDate = reportData.generatedAt
      ? new Date(reportData.generatedAt).toLocaleDateString('es-PE', { year: 'numeric', month: 'long', day: 'numeric' })
      : new Date().toLocaleDateString('es-PE', { year: 'numeric', month: 'long', day: 'numeric' });

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Por favor permite ventanas emergentes para descargar el PDF.');
      return;
    }

    // Strip inline <style> from content — the print window supplies its own
    const contentToPrint = (reportData.content || '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

    printWindow.document.write(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>${reportTitle}</title>
  <!-- Mermaid CDN: renders diagrams before print -->
  <script src="${MERMAID_CDN}"><\/script>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 30px 44px;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 13.5px;
      line-height: 1.75;
      color: #333;
      background: #fff;
    }
    h1 { font-size: 26px; color: #000; margin: 0 0 6px 0; padding-bottom: 10px; border-bottom: 3px solid #bbb; }
    h2 { font-size: 20px; color: #1a1a1a; margin: 30px 0 10px; padding-bottom: 5px; border-bottom: 2px solid #ddd; }
    h3 { font-size: 17px; color: #2c2c2c; margin: 22px 0 8px; }
    h4 { font-size: 15px; color: #2c2c2c; margin: 16px 0 6px; }
    p  { margin: 0 0 13px; }
    ul, ol { margin: 10px 0; padding-left: 26px; }
    li { margin: 5px 0; }
    strong { font-weight: 700; color: #000; }
    em { font-style: italic; color: #444; }
    a  { color: #0066cc; }
    /* Tables */
    table { width: 100%; border-collapse: collapse; margin: 16px 0; page-break-inside: avoid; }
    th { background: #f0f4f8; padding: 8px 12px; border: 1px solid #ccc; font-weight: 700; text-align: left; }
    td { padding: 8px 12px; border: 1px solid #ddd; vertical-align: top; }
    tr:nth-child(even) td { background: #fafafa; }
    /* Figures / SVG charts */
    figure { margin: 24px 0; page-break-inside: avoid; }
    figcaption { font-weight: 700; font-size: 14px; text-align: center; margin-bottom: 10px; }
    figure p { text-align: center; font-size: 11px; color: #888; margin-top: 6px; }
    svg { max-width: 100%; height: auto; }
    /* Mermaid diagrams */
    .mermaid { margin: 20px auto; max-width: 700px; text-align: center; page-break-inside: avoid; }
    @media print {
      body { padding: 16px 28px; }
      h1, h2, h3, h4 { page-break-after: avoid; }
      table, figure, .mermaid { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div style="text-align:center;margin-bottom:32px;">
    <h1 style="border:none;padding:0;margin-bottom:4px;">${reportTitle}</h1>
    <p style="color:#888;font-size:12px;margin:0;">${generatedDate}</p>
  </div>
  ${contentToPrint}
  <script>
    // Initialise Mermaid diagrams, then trigger print after they render
    function startPrint() {
      if (window.mermaid) {
        try {
          mermaid.initialize({ startOnLoad: false, theme: 'default' });
          mermaid.run({ querySelector: '.mermaid' });
        } catch(e) {}
      }
      // Wait for Mermaid SVG rendering, then print
      setTimeout(function() { window.print(); }, 1200);
    }
    if (document.readyState === 'complete') {
      startPrint();
    } else {
      window.addEventListener('load', startPrint);
    }
  <\/script>
</body>
</html>`);

    printWindow.document.close();
    printWindow.focus();
  };

  return (
    <div className={`c-report-canvas ${className}`} id="gemini-report-canvas">
      <div className="c-report-canvas__header">
        <h1>{dashboardData.title || 'POLISENSE.AI REPORT'}</h1>
        <div className="c-report-canvas__meta">
          <span>
            {reportData.generatedAt
              ? new Date(reportData.generatedAt).toLocaleDateString()
              : new Date().toLocaleDateString()}
          </span>
        </div>
      </div>

      <div className="c-report-canvas__content">
        <div className="c-report-canvas__text" ref={reportTextRef}>
          {reportData.isGemini ? (
            <div
              ref={contentRef}
              className="c-report-canvas__gemini-content"
              style={{ fontSize: '16px', lineHeight: '1.7', color: '#333' }}
            >
              {/* ── Scoped styles for headings, tables, figures, mermaid ── */}
              <style dangerouslySetInnerHTML={{ __html: `
                #gemini-report-canvas .c-report-canvas__gemini-content h1,
                #gemini-report-canvas .c-report-canvas__gemini-content h2,
                #gemini-report-canvas .c-report-canvas__gemini-content h3,
                #gemini-report-canvas .c-report-canvas__gemini-content h4,
                #gemini-report-canvas .c-report-canvas__gemini-content h5,
                #gemini-report-canvas .c-report-canvas__gemini-content h6 {
                  color: #1a1a1a !important;
                  margin: 30px 0 15px !important;
                  padding-bottom: 8px !important;
                  border-bottom: 2px solid #e0e0e0 !important;
                  font-weight: 700 !important;
                }
                #gemini-report-canvas .c-report-canvas__gemini-content h1 {
                  font-size: 32px !important; color: #000 !important;
                  border-bottom: 3px solid #d0d0d0 !important; margin-top: 0 !important;
                }
                #gemini-report-canvas .c-report-canvas__gemini-content h2 { font-size: 26px !important; }
                #gemini-report-canvas .c-report-canvas__gemini-content h3 { font-size: 22px !important; color: #2c2c2c !important; }
                #gemini-report-canvas .c-report-canvas__gemini-content h4 { font-size: 19px !important; color: #2c2c2c !important; }
                #gemini-report-canvas .c-report-canvas__gemini-content h5 { font-size: 17px !important; color: #333 !important; }
                #gemini-report-canvas .c-report-canvas__gemini-content h6 { font-size: 15px !important; color: #333 !important; }
                #gemini-report-canvas .c-report-canvas__gemini-content p  { margin: 0 0 18px !important; line-height: 1.8 !important; color: #333 !important; }
                #gemini-report-canvas .c-report-canvas__gemini-content ul,
                #gemini-report-canvas .c-report-canvas__gemini-content ol  { margin: 18px 0 !important; padding-left: 35px !important; color: #333 !important; }
                #gemini-report-canvas .c-report-canvas__gemini-content li  { margin: 10px 0 !important; line-height: 1.7 !important; color: #333 !important; }
                #gemini-report-canvas .c-report-canvas__gemini-content strong { font-weight: 700 !important; color: #000 !important; }
                #gemini-report-canvas .c-report-canvas__gemini-content em    { font-style: italic !important; color: #444 !important; }
                #gemini-report-canvas .c-report-canvas__gemini-content a     { color: #0066cc !important; text-decoration: underline !important; }
                /* Tables */
                #gemini-report-canvas .c-report-canvas__gemini-content table {
                  width: 100% !important; border-collapse: collapse !important;
                  margin: 20px 0 !important; font-size: 14px !important;
                }
                #gemini-report-canvas .c-report-canvas__gemini-content th {
                  background: #f0f4f8 !important; padding: 9px 13px !important;
                  border: 1px solid #ccc !important; font-weight: 700 !important;
                  text-align: left !important; color: #1a1a1a !important;
                }
                #gemini-report-canvas .c-report-canvas__gemini-content td {
                  padding: 8px 13px !important; border: 1px solid #ddd !important;
                  vertical-align: top !important; color: #333 !important;
                }
                #gemini-report-canvas .c-report-canvas__gemini-content tr:nth-child(even) td {
                  background: #fafafa !important;
                }
                /* SVG / figure */
                #gemini-report-canvas .c-report-canvas__gemini-content figure {
                  margin: 28px 0 !important; text-align: center !important;
                }
                #gemini-report-canvas .c-report-canvas__gemini-content figcaption {
                  font-weight: 700 !important; font-size: 14px !important;
                  margin-bottom: 10px !important; color: #1a1a1a !important;
                }
                #gemini-report-canvas .c-report-canvas__gemini-content svg {
                  max-width: 100% !important; height: auto !important;
                }
                /* Mermaid diagrams */
                #gemini-report-canvas .c-report-canvas__gemini-content .mermaid {
                  margin: 24px auto !important; max-width: 700px !important;
                  text-align: center !important;
                }
                #gemini-report-canvas .c-report-canvas__gemini-content .mermaid svg {
                  max-width: 100% !important;
                }
              ` }} />

              {mainContent && mainContent.length > 0 ? (
                isHTML ? (
                  <div dangerouslySetInnerHTML={{ __html: mainContent }} />
                ) : (
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      h1: ({node, children, ...props}) => <h1 {...props} style={{color:'#000',fontSize:'32px',fontWeight:700,margin:'30px 0 15px',paddingBottom:'8px',borderBottom:'3px solid #d0d0d0'}}>{children}</h1>,
                      h2: ({node, children, ...props}) => <h2 {...props} style={{color:'#1a1a1a',fontSize:'26px',fontWeight:700,margin:'30px 0 15px',paddingBottom:'8px',borderBottom:'2px solid #e0e0e0'}}>{children}</h2>,
                      h3: ({node, children, ...props}) => <h3 {...props} style={{color:'#2c2c2c',fontSize:'22px',fontWeight:600,margin:'24px 0 12px'}}>{children}</h3>,
                      h4: ({node, children, ...props}) => <h4 {...props} style={{color:'#2c2c2c',fontSize:'19px',fontWeight:600,margin:'20px 0 10px'}}>{children}</h4>,
                      p:  ({node, children, ...props}) => <p  {...props} style={{color:'#333',margin:'0 0 18px',lineHeight:1.8}}>{children}</p>,
                      strong: ({node, children, ...props}) => <strong {...props} style={{color:'#000',fontWeight:700}}>{children}</strong>,
                      em:     ({node, children, ...props}) => <em     {...props} style={{color:'#444',fontStyle:'italic'}}>{children}</em>,
                      a:      ({node, children, ...props}) => <a      {...props} style={{color:'#0066cc',textDecoration:'underline'}}>{children}</a>,
                      ul: ({node, children, ...props}) => <ul {...props} style={{color:'#333',margin:'18px 0',paddingLeft:'35px'}}>{children}</ul>,
                      ol: ({node, children, ...props}) => <ol {...props} style={{color:'#333',margin:'18px 0',paddingLeft:'35px'}}>{children}</ol>,
                      li: ({node, children, ...props}) => <li {...props} style={{color:'#333',margin:'10px 0',lineHeight:1.7}}>{children}</li>,
                      table: ({node, children, ...props}) => <table {...props} style={{width:'100%',borderCollapse:'collapse',margin:'20px 0',fontSize:'14px'}}>{children}</table>,
                      th: ({node, children, ...props}) => <th {...props} style={{background:'#f0f4f8',padding:'9px 13px',border:'1px solid #ccc',fontWeight:700,textAlign:'left'}}>{children}</th>,
                      td: ({node, children, ...props}) => <td {...props} style={{padding:'8px 13px',border:'1px solid #ddd',verticalAlign:'top'}}>{children}</td>,
                    }}
                  >
                    {String(mainContent)}
                  </ReactMarkdown>
                )
              ) : (
                <div>
                  <p style={{color:'red'}}>⚠️ No content available after extraction</p>
                  <details>
                    <summary>Debug: Show raw content</summary>
                    <pre style={{fontSize:'12px',overflow:'auto',maxHeight:'200px'}}>
                      {JSON.stringify({mainContent, originalContent: reportData.content?.substring(0, 500)}, null, 2)}
                    </pre>
                  </details>
                </div>
              )}
            </div>
          ) : (
            // Fallback plain-text rendering
            reportData.content.split('\n').map((paragraph, index) => {
              if (!paragraph.trim()) return null;
              if (paragraph.trim().startsWith('#') || /^[A-Z\s]+$/.test(paragraph.trim())) {
                return <h2 key={index} className="c-report-canvas__heading">{paragraph.replace(/^#+\s*/, '').trim()}</h2>;
              }
              if (/^[\s]*[-•*]\s/.test(paragraph) || /^[\s]*\d+\.\s/.test(paragraph)) {
                return <div key={index} className="c-report-canvas__list-item">{paragraph.trim()}</div>;
              }
              return <p key={index} className="c-report-canvas__paragraph">{paragraph.trim()}</p>;
            })
          )}
        </div>
      </div>

      {/* Download buttons */}
      <div className="c-report-canvas__download-buttons">
        <h3>📄 Descargar Reporte</h3>
        <div className="c-report-canvas__download-buttons__container">
          <button
            onClick={handlePrint}
            className="c-report-canvas__download-button c-report-canvas__download-button--print"
          >
            📄 Imprimir/Guardar PDF
          </button>
        </div>
      </div>
    </div>
  );
};

DynamicDashboard.propTypes = {
  dashboardData: PropTypes.shape({
    type: PropTypes.string.isRequired,
    title: PropTypes.string.isRequired,
    subtitle: PropTypes.string,
    template: PropTypes.string.isRequired,
    sections: PropTypes.arrayOf(PropTypes.shape({
      id: PropTypes.string.isRequired,
      title: PropTypes.string.isRequired,
      type: PropTypes.string.isRequired,
      data: PropTypes.any.isRequired,
    })).isRequired,
  }).isRequired,
  className: PropTypes.string,
};

export default DynamicDashboard;
