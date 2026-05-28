import React, { useState, useCallback, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const MessageRenderer = ({ message, sender = 'bot', className = '' }) => {
  console.log('🔍 MessageRenderer: Component rendered with message length:', message?.length);
  console.log('🔍 MessageRenderer: Message preview:', message?.substring(0, 200) + '...');

  const [copiedTableId, setCopiedTableId] = useState(null);
  const markdownRef = useRef(null);

  // Function to extract table data and convert to TSV format
  const extractTableData = useCallback((tableElement) => {
    const rows = [];
    const tableRows = tableElement.querySelectorAll('tr');
    
    tableRows.forEach((row) => {
      const cells = [];
      const rowCells = row.querySelectorAll('th, td');
      rowCells.forEach((cell) => {
        cells.push(cell.textContent.trim());
      });
      rows.push(cells.join('\t'));
    });
    
    return rows.join('\n');
  }, []);

  // Function to copy table to clipboard
  const handleCopyTable = useCallback(async (event, tableElement) => {
    event.preventDefault();
    event.stopPropagation();
    
    try {
      const tableData = extractTableData(tableElement);
      const tableId = tableElement.getAttribute('data-table-id');
      
      // Try modern Clipboard API first
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(tableData);
      } else {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = tableData;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      
      // Show feedback
      setCopiedTableId(tableId);
      setTimeout(() => {
        setCopiedTableId(null);
      }, 2000);
    } catch (error) {
      console.error('Failed to copy table:', error);
    }
  }, [extractTableData]);

  // Add copy buttons to all tables after render
  useEffect(() => {
    if (!markdownRef.current) return;

    const tables = markdownRef.current.querySelectorAll('table:not([data-copy-button-added])');
    
    tables.forEach((table) => {
      // Mark table as processed
      table.setAttribute('data-copy-button-added', 'true');
      
      // Generate unique ID for this table
      const tableId = `table-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      table.setAttribute('data-table-id', tableId);
      
      // Wrap table in a container if not already wrapped
      if (!table.parentElement.classList.contains('table-wrapper-with-copy')) {
        const wrapper = document.createElement('div');
        wrapper.className = 'table-wrapper-with-copy';
        table.parentNode.insertBefore(wrapper, table);
        wrapper.appendChild(table);
      }
      
      // Create copy button
      const button = document.createElement('button');
      button.className = 'table-copy-button';
      button.setAttribute('title', 'Copy table');
      button.setAttribute('aria-label', 'Copy table');
      button.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M5.5 4.5H3.5C2.67157 4.5 2 5.17157 2 6V12.5C2 13.3284 2.67157 14 3.5 14H10C10.8284 14 11.5 13.3284 11.5 12.5V10.5M5.5 4.5H12.5C13.3284 4.5 14 5.17157 14 6V10.5M5.5 4.5V2.5C5.5 1.67157 6.17157 1 7 1H10.5L14 4.5V10.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      `;
      
      button.addEventListener('click', (e) => {
        handleCopyTable(e, table);
      });
      
      // Add button to wrapper
      const wrapper = table.parentElement;
      if (wrapper.classList.contains('table-wrapper-with-copy')) {
        wrapper.appendChild(button);
      }
    });
  }, [message, handleCopyTable, copiedTableId]);

  // Update button state when copiedTableId changes
  useEffect(() => {
    if (!markdownRef.current) return;
    
    const tables = markdownRef.current.querySelectorAll('table[data-table-id]');
    tables.forEach((table) => {
      const tableId = table.getAttribute('data-table-id');
      const wrapper = table.parentElement;
      if (wrapper && wrapper.classList.contains('table-wrapper-with-copy')) {
        const button = wrapper.querySelector('.table-copy-button');
        if (button) {
          if (copiedTableId === tableId) {
            button.classList.add('copied');
            button.setAttribute('title', 'Copied!');
            button.innerHTML = `
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M13.5 4L6 11.5L2.5 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            `;
          } else {
            button.classList.remove('copied');
            button.setAttribute('title', 'Copy table');
            button.innerHTML = `
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M5.5 4.5H3.5C2.67157 4.5 2 5.17157 2 6V12.5C2 13.3284 2.67157 14 3.5 14H10C10.8284 14 11.5 13.3284 11.5 12.5V10.5M5.5 4.5H12.5C13.3284 4.5 14 5.17157 14 6V10.5M5.5 4.5V2.5C5.5 1.67157 6.17157 1 7 1H10.5L14 4.5V10.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            `;
          }
        }
      }
    });
  }, [copiedTableId]);

  // Detect raw HTML responses (e.g. LLM-generated reports with <h1>, <table>, etc.)
  const isHTML = /<[a-z][\s\S]*>/i.test((message || '').trim()) &&
    !(/^#{1,6}\s|\*\*[^*]+\*\*|^\d+\.\s|^-\s|^\*\s/m.test(message));

    return (
    <div className={`message-renderer ${className}`}>
      {/* Render all content as markdown or raw HTML */}
      <div className="message-renderer-markdown" ref={markdownRef}>
        {isHTML ? (
          <div dangerouslySetInnerHTML={{ __html: message }} />
        ) : (
          <ReactMarkdown plugins={[remarkGfm]} escapeHtml={false}>
            {message}
          </ReactMarkdown>
        )}
      </div>

      <style jsx>{`
        .message-renderer {
          width: 100%;
        }

        .message-renderer-markdown {
          margin-bottom: 0;
        }

        /* Ensure markdown content inherits the parent's color scheme */
        .message-renderer-markdown :global(*) {
          color: inherit;
        }

        .message-renderer-markdown :global(h1),
        .message-renderer-markdown :global(h2),
        .message-renderer-markdown :global(h3),
        .message-renderer-markdown :global(h4),
        .message-renderer-markdown :global(h5),
        .message-renderer-markdown :global(h6) {
          margin: 1.5rem 0 0.5rem 0;
          font-weight: 600;
          color: inherit;
        }

        .message-renderer-markdown :global(h1) { font-size: 1.875rem; }
        .message-renderer-markdown :global(h2) { font-size: 1.5rem; }
        .message-renderer-markdown :global(h3) { font-size: 1.25rem; }
        .message-renderer-markdown :global(h4) { font-size: 1.125rem; }
        .message-renderer-markdown :global(h5) { font-size: 1rem; }
        .message-renderer-markdown :global(h6) { font-size: 0.875rem; }

        .message-renderer-markdown :global(p) {
          margin: 0.75rem 0;
        }

        .message-renderer-markdown :global(ul),
        .message-renderer-markdown :global(ol) {
          margin: 0.75rem 0;
          padding-left: 1.5rem;
        }

        .message-renderer-markdown :global(li) {
          margin: 0.25rem 0;
        }

        .message-renderer-markdown :global(blockquote) {
          margin: 1rem 0;
          padding: 0.5rem 1rem;
          border-left: 4px solid rgba(255, 255, 255, 0.3);
          background: rgba(255, 255, 255, 0.05);
          font-style: italic;
        }

        .message-renderer-markdown :global(code) {
          background: rgba(255, 255, 255, 0.1);
          padding: 0.125rem 0.25rem;
          border-radius: 4px;
          font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
          font-size: 0.875em;
        }

        .message-renderer-markdown :global(pre) {
          background: rgba(38, 52, 67, 0.85);
          border: 1px solid rgba(78, 255, 208, 0.15);
          color: #f9fafb;
          padding: 1rem;
          border-radius: 6px;
          overflow-x: auto;
          margin: 1rem 0;
        }

        .message-renderer-markdown :global(pre code) {
          background: none;
          padding: 0;
          color: inherit;
        }

        .message-renderer-markdown :global(a) {
          color: #4effd0;
          text-decoration: none;
        }

        .message-renderer-markdown :global(a:hover) {
          color: #a8fff0;
          text-decoration: underline;
        }

        .message-renderer-markdown :global(table) {
          border-collapse: collapse;
          width: auto;
          min-width: 100%;
          max-width: 100%;
          margin: 1rem 0;
          font-size: 0.875rem;
          overflow-x: auto;
          display: block;
        }

        /* Add a wrapper for table scrolling */
        .message-renderer-markdown :global(.table-wrapper) {
          overflow-x: auto;
          max-width: 100%;
          margin: 1rem 0;
          border-radius: 6px;
          border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .message-renderer-markdown :global(th),
        .message-renderer-markdown :global(td) {
          border: 1px solid rgba(255, 255, 255, 0.2);
          padding: 0.375rem 0.5rem;
          text-align: left;
          white-space: nowrap;
          min-width: 80px;
        }

        .message-renderer-markdown :global(th) {
          background: rgba(255, 255, 255, 0.1);
          font-weight: 600;
        }

        .message-renderer-markdown :global(tr:nth-child(even)) {
          background: rgba(255, 255, 255, 0.05);
        }

        /* Table wrapper with copy button */
        .message-renderer-markdown :global(.table-wrapper-with-copy) {
          position: relative;
          margin: 1rem 0;
          display: block;
          width: 100%;
          max-width: 100%;
          overflow-x: auto;
        }

        .message-renderer-markdown :global(.table-wrapper-with-copy table) {
          border-collapse: collapse;
          width: auto;
          min-width: 100%;
          max-width: 100%;
          margin: 0 !important;
          font-size: 0.875rem;
          display: table;
        }

        /* Copy button styles */
        .message-renderer-markdown :global(.table-copy-button) {
          position: absolute;
          bottom: 8px;
          right: 8px;
          background: rgba(0, 0, 0, 0.7);
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 4px;
          padding: 6px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          color: rgba(255, 255, 255, 0.8);
          transition: all 0.2s ease;
          z-index: 10;
          opacity: 0.7;
          pointer-events: auto;
        }

        .message-renderer-markdown :global(.table-wrapper-with-copy:hover .table-copy-button) {
          opacity: 1;
        }

        .message-renderer-markdown :global(.table-copy-button:hover) {
          background: rgba(0, 0, 0, 0.9);
          color: rgba(255, 255, 255, 1);
          border-color: rgba(255, 255, 255, 0.4);
          transform: scale(1.05);
        }

        .message-renderer-markdown :global(.table-copy-button:active) {
          transform: scale(0.95);
        }

        .message-renderer-markdown :global(.table-copy-button.copied) {
          background: rgba(34, 197, 94, 0.9);
          border-color: rgba(34, 197, 94, 1);
          color: white;
          opacity: 1;
        }

        .message-renderer-markdown :global(.table-copy-button svg) {
          display: block;
          width: 16px;
          height: 16px;
        }
      `}</style>
    </div>
  );
};

MessageRenderer.propTypes = {
  message: PropTypes.string.isRequired,
  sender: PropTypes.oneOf(['user', 'assistant', 'system', 'bot']),
  className: PropTypes.string
};

export default MessageRenderer;
