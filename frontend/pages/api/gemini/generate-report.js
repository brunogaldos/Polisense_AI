/**
 * API route to handle AI report generation via OpenAI GPT-4o
 * Generates rich HTML reports with inline SVG charts, Mermaid diagrams, and tables.
 */

import fs from 'fs';
import path from 'path';

// Raise body parser limit — conversations with map snapshots can exceed the 1 MB default
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

const readEnvValue = (filePath, key) => {
  try {
    if (!fs.existsSync(filePath)) return '';

    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;

      const separatorIndex = line.indexOf('=');
      if (separatorIndex === -1) continue;

      const name = line.slice(0, separatorIndex).trim();
      if (name !== key) continue;

      return line
        .slice(separatorIndex + 1)
        .trim()
        .replace(/^['"]|['"]$/g, '');
    }
  } catch (error) {
    console.warn(`⚠️ Could not read ${key} from ${filePath}:`, error.message);
  }

  return '';
};

const resolveOpenAiApiKey = () => {
  const backendEnvPaths = [
    path.resolve(process.cwd(), '../backend/.env'),
    path.resolve(process.cwd(), '../backend/.env.production'),
  ];

  for (const backendEnvPath of backendEnvPaths) {
    const backendKey = readEnvValue(backendEnvPath, 'OPENAI_API_KEY');
    if (backendKey) return backendKey;
  }

  return process.env.OPENAI_API_KEY || process.env.NEXT_PUBLIC_OPENAI_API_KEY || '';
};

const OPENAI_CONFIG = {
  MODEL: 'gpt-4o',
  API_BASE: 'https://api.openai.com/v1/chat/completions',
};

const stripMarkdown = (value = '') => String(value).replace(/\*\*/g, '').replace(/`/g, '').trim();

const looksLikeAssistantMessage = (message = '') => {
  const text = String(message || '').trim();
  if (!text) return false;

  const hasMarkdown =
    text.includes('**') ||
    (text.includes('*') && text.split('*').length > 2) ||
    text.includes('###') ||
    text.includes('##') ||
    text.includes('# ') ||
    (text.includes('- ') && text.split('- ').length > 2) ||
    text.includes('1. ') ||
    text.includes('2. ') ||
    (text.includes('[') && text.includes(']('));

  const isLongMessage = text.length > 100;

  return (
    hasMarkdown ||
    (isLongMessage &&
      !text.startsWith('?') &&
      !text.toLowerCase().startsWith('what') &&
      !text.toLowerCase().startsWith('how'))
  );
};

const normalizeSenderForReport = (msg = {}) => {
  const sender = msg.sender;
  const isAssistantLike =
    msg.messageType === 'research_result' ||
    msg.messageType === 'intermediate' ||
    msg.messageType === 'completed' ||
    looksLikeAssistantMessage(msg.message);

  if (sender === 'assistant') return 'assistant';
  if (sender === 'bot') return 'assistant';

  if (isAssistantLike) {
    return 'assistant';
  }

  if (msg.messageType === 'user_query') return 'user';
  if (sender === 'user' || sender === 'system') return sender;
  return sender || 'user';
};

const buildConcessionsTableFromChatSummary = (text = '') => {
  const lines = String(text).split('\n');
  const startIdx = lines.findIndex(
    (line) => /Se encontraron/i.test(line) && /concesi[oó]n\(es\)\s+minera\(s\)/i.test(line),
  );

  if (startIdx < 0) return null;

  const rows = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      if (rows.length > 0) break;
      continue;
    }

    const itemMatch = line.match(/^\d+\.\s*(.+)$/);
    if (!itemMatch) {
      if (rows.length > 0) break;
      continue;
    }

    const rowText = stripMarkdown(itemMatch[1]);
    const rowMatch = rowText.match(
      /^(.*?)\s*[—-]\s*Estado:\s*(.*?)(?:\s*[—-]\s*Titular:\s*(.*))?$/i,
    );

    if (rowMatch) {
      rows.push({
        name: stripMarkdown(rowMatch[1]) || 'N/D',
        status: stripMarkdown(rowMatch[2]) || 'N/D',
        holder: stripMarkdown(rowMatch[3] || '') || 'N/D',
      });
      continue;
    }

    rows.push({
      name: rowText || 'N/D',
      status: 'N/D',
      holder: 'N/D',
    });
  }

  if (rows.length === 0) return null;

  const body = rows
    .map(
      (row, idx) => `
      <tr>
        <td style="padding:8px 12px;border:1px solid #ddd;">${idx + 1}</td>
        <td style="padding:8px 12px;border:1px solid #ddd;">${row.name}</td>
        <td style="padding:8px 12px;border:1px solid #ddd;">${row.status}</td>
        <td style="padding:8px 12px;border:1px solid #ddd;">${row.holder}</td>
      </tr>`,
    )
    .join('');

  return `<h3>Tabla de Concesiones Mineras</h3>
<table style="width:100%;border-collapse:collapse;margin:16px 0;">
  <thead>
    <tr>
      <th style="background:#f0f4f8;padding:8px 12px;border:1px solid #ccc;font-weight:700;">#</th>
      <th style="background:#f0f4f8;padding:8px 12px;border:1px solid #ccc;font-weight:700;">Concesión</th>
      <th style="background:#f0f4f8;padding:8px 12px;border:1px solid #ccc;font-weight:700;">Estado</th>
      <th style="background:#f0f4f8;padding:8px 12px;border:1px solid #ccc;font-weight:700;">Titular</th>
    </tr>
  </thead>
  <tbody>${body}
  </tbody>
</table>`;
};

const buildMiningConcessionsTable = (text = '', mapSnapshots = []) => {
  const lines = String(text)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const rows = [];
  const seen = new Set();

  const tryPush = ({ name, lat, lon, reference = 'N/D', radius = 'N/D', source = 'N/D' }) => {
    const latNum = Number(lat);
    const lonNum = Number(lon);

    if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) return;
    if (latNum < -90 || latNum > 90) return;
    if (lonNum < -180 || lonNum > 180) return;

    const key = `${latNum.toFixed(6)}|${lonNum.toFixed(6)}|${name || ''}`;
    if (seen.has(key)) return;
    seen.add(key);

    rows.push({
      name: name || `Punto ${rows.length + 1}`,
      lat: latNum.toFixed(6),
      lon: lonNum.toFixed(6),
      reference,
      radius,
      source,
    });
  };

  lines.forEach((line) => {
    let match = line.match(
      /(?:lat(?:itud)?)[^\d-]*(-?\d+(?:\.\d+)?).{0,80}?(?:lon(?:gitud|g)?)[^\d-]*(-?\d+(?:\.\d+)?)/i,
    );
    if (match) {
      const label = line
        .split(/lat(?:itud)?/i)[0]
        .replace(/^[-*•\d.\s]+/, '')
        .trim();
      tryPush({ name: label, lat: match[1], lon: match[2] });
      return;
    }

    match = line.match(/\(\s*(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)\s*\)/);
    if (match) {
      const label = line
        .replace(match[0], '')
        .replace(/^[-*•\d.\s]+/, '')
        .trim();
      tryPush({ name: label, lat: match[1], lon: match[2] });
      return;
    }

    match = line.match(/(-?\d{1,2}\.\d{3,})\s*[,;|\s]\s*(-?\d{1,3}\.\d{3,})/);
    if (match) {
      const label = line
        .split(match[0])[0]
        .replace(/^[-*•\d.\s]+/, '')
        .trim();
      tryPush({ name: label, lat: match[1], lon: match[2] });
    }
  });

  // Fallback: build a concessions summary table from map snapshots when no
  // explicit coordinate rows were found in text.
  if (rows.length === 0 && Array.isArray(mapSnapshots) && mapSnapshots.length > 0) {
    mapSnapshots.forEach((msg) => {
      const snap = msg?.mapSnapshot || {};
      rows.push({
        name: snap.place || `Zona ${rows.length + 1}`,
        lat: 'N/D',
        lon: 'N/D',
        reference: snap.place || 'N/D',
        radius: snap.radiusKm != null ? `${snap.radiusKm} km` : 'N/D',
        source: snap.count != null ? `${snap.count} concesiones` : 'N/D',
      });
    });
  }

  if (rows.length === 0) {
    return null;
  }

  const body = rows
    .map(
      (row, idx) => `
      <tr>
        <td style="padding:8px 12px;border:1px solid #ddd;">${idx + 1}</td>
        <td style="padding:8px 12px;border:1px solid #ddd;">${row.name}</td>
        <td style="padding:8px 12px;border:1px solid #ddd;">${row.lat}</td>
        <td style="padding:8px 12px;border:1px solid #ddd;">${row.lon}</td>
        <td style="padding:8px 12px;border:1px solid #ddd;">${row.reference}</td>
        <td style="padding:8px 12px;border:1px solid #ddd;">${row.radius}</td>
        <td style="padding:8px 12px;border:1px solid #ddd;">${row.source}</td>
      </tr>`,
    )
    .join('');

  return `<h3>Tabla de Concesiones Mineras</h3>
<table style="width:100%;border-collapse:collapse;margin:16px 0;">
  <thead>
    <tr>
      <th style="background:#f0f4f8;padding:8px 12px;border:1px solid #ccc;font-weight:700;">#</th>
      <th style="background:#f0f4f8;padding:8px 12px;border:1px solid #ccc;font-weight:700;">Nombre/Lugar</th>
      <th style="background:#f0f4f8;padding:8px 12px;border:1px solid #ccc;font-weight:700;">Latitud</th>
      <th style="background:#f0f4f8;padding:8px 12px;border:1px solid #ccc;font-weight:700;">Longitud</th>
      <th style="background:#f0f4f8;padding:8px 12px;border:1px solid #ccc;font-weight:700;">Dirección/Referencia</th>
      <th style="background:#f0f4f8;padding:8px 12px;border:1px solid #ccc;font-weight:700;">Distancia/Radio</th>
      <th style="background:#f0f4f8;padding:8px 12px;border:1px solid #ccc;font-weight:700;">Fuente</th>
    </tr>
  </thead>
  <tbody>${body}
  </tbody>
</table>`;
};

export default async function handler(req, res) {
  const apiKey = resolveOpenAiApiKey();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!apiKey) {
    console.error('❌ Server: OPENAI_API_KEY is not configured.');
    return res
      .status(500)
      .json({ error: 'OpenAI API key not configured. Set OPENAI_API_KEY in your environment.' });
  }

  console.log('🔑 Server: OpenAI key loaded, starting report generation...');

  try {
    const { conversation } = req.body;

    if (!conversation || conversation.length === 0) {
      return res.status(400).json({ error: 'No conversation data provided' });
    }

    const normalizedConversation = conversation.map((msg) => ({
      ...msg,
      sender: normalizeSenderForReport(msg),
    }));

    const assistantAllowedTypes = new Set([
      'research_result',
      'text',
      '',
      'geojson',
      'geojson_rag',
      'completed',
    ]);

    const assistantMessages = normalizedConversation
      .filter((msg) => {
        if (msg.sender !== 'assistant') return false;

        // Include geo-related assistant payloads so coordinate tables are complete.
        if (assistantAllowedTypes.has(msg.messageType)) return true;
        if (msg.messageType === undefined || msg.messageType === null) return true;
        return false;
      })
      .map((msg) => (typeof msg.message === 'string' ? msg.message : ''))
      .filter(Boolean);

    // Collect deep-analysis chart panels (Plotly HTML) for iframe injection.
    // These are local-only messages not stored in the backend — their HTML is
    // passed through from the frontend's in-memory state.
    const analysisPanels = normalizedConversation
      .filter((msg) => msg.messageType === 'analysis_panel' && msg.analysisPanel?.html)
      .map((msg) => msg.analysisPanel)
      .sort((a, b) => (a.index || 0) - (b.index || 0));

    if (assistantMessages.length === 0) {
      return res.status(400).json({ error: 'No assistant research results found in conversation' });
    }

    // Collect map snapshots to inject as figures in the final report
    const mapSnapshots = normalizedConversation.filter(
      (msg) =>
        msg.messageType === 'map_snapshot' && (msg.mapSnapshot?.url || msg.mapSnapshot?.dataUrl),
    );

    // Add geospatial snapshot metadata into the prompt context.
    const snapshotContext = mapSnapshots
      .map((msg, idx) => {
        const snap = msg.mapSnapshot || {};
        return [
          `Snapshot ${idx + 1}:`,
          `place=${snap.place || 'N/D'}`,
          `count=${snap.count ?? 'N/D'}`,
          `radiusKm=${snap.radiusKm ?? 'N/D'}`,
        ].join(' ');
      })
      .join('\n');

    const combinedContent = [
      assistantMessages.join('\n\n---\n\n'),
      snapshotContext ? `\n\nGeospatial snapshot metadata:\n${snapshotContext}` : '',
    ].join('');

    const allConversationText = normalizedConversation
      .map((msg) => (typeof msg.message === 'string' ? msg.message : ''))
      .filter(Boolean)
      .join('\n');

    // ─────────────────────────────────────────────────────────────────────────
    // SYSTEM PROMPT
    // ─────────────────────────────────────────────────────────────────────────
    const systemPrompt = `You are an expert analyst and data visualisation specialist producing a professional executive report.
Output ONLY inner HTML — no <html>, <head>, <body>, <style>, or <script> tags.
Start directly with <h1>Executive Summary</h1>.
Write in English. Use dark colours (#000, #1a1a1a, #333) — never red (#e74c3c, crimson, red).
Do NOT use markdown, backticks, or code fences.

═══════════════════════════════════════════════════
VISUALISATION RULES — apply these autonomously
═══════════════════════════════════════════════════

┌─ TABLES (HIGH PRIORITY) ─────────────────────────────────────────────────┐
│ Use <table><thead><tbody> for any data with ≥2 items and ≥2 attributes.   │
│ Style each <th> with background:#f0f4f8;padding:8px 12px;border:1px solid │
│ #ccc;font-weight:700; and each <td> with padding:8px 12px;border:1px      │
│ solid #ddd;                                                                 │
│ IMPORTANT: When geospatial data exists, include a complete coordinates      │
│ table. Do not omit rows.                                                     │
│ Required columns for coordinates table: #, Name/Place, Latitude, Longitude, │
│ Address/Reference (if available), Distance/Radius (if available),           │
│ Source (if available).                                                       │
│ If some fields are missing for a row, keep the row and use "N/A" in that   │
│ cell. Never skip available points.                                           │
└──────────────────────────────────────────────────────────────────────────-┘

┌─ CHARTS ───────────────────────────────────────────────────────────────────┐
│ Avoid bar charts for small datasets. Prefer HTML tables instead.           │
│ If there is no clear benefit from a chart, do not generate one.            │
└───────────────────────────────────────────────────────────────────────────┘

┌─ DIAGRAMS ────────────────────────────────────────────────────────────────┐
│ Do NOT generate Mermaid diagrams, flowcharts, quadrant charts, gantt, pie, │
│ SVG charts, or any chart figure. Use HTML tables only.                     │
└───────────────────────────────────────────────────────────────────────────┘

PLACEMENT RULES:
• Add a visualisation immediately after the paragraph that introduces the data.
• Each major section (Key Findings, Detailed Analysis) must contain AT LEAST one table.
• Choose the type that best matches the data:
    - Rankings / comparisons       → HTML table
    - Trends over time             → HTML table
    - Parts of a whole             → HTML table
    - Processes / decisions        → HTML table
    - Roadmaps / phases            → HTML table
    - Structured multi-attribute   → HTML table
    - Priority / effort-impact     → HTML table
• Only add visuals when real data exists in the input — never invent numbers.
• IMPORTANT: Do not generate diagrams or charts. Only HTML tables.`;

    // ─────────────────────────────────────────────────────────────────────────
    // USER PROMPT
    // ─────────────────────────────────────────────────────────────────────────
    const userPrompt = `Research data to transform into a complete executive report:

${combinedContent}

═══════════════════════════════════════════════════════════════════
REQUIRED STRUCTURE — complete every section, add visuals where data allows
═══════════════════════════════════════════════════════════════════

<h1>Executive Summary</h1>
2–4 paragraph overview of key findings, conclusions, and critical recommendations.
Include a summary table if multiple topics are covered.

<h2>Key Findings</h2>
Organize with <h3> subsections. Each subsection that contains numeric data MUST include
a table or diagram. Prioritize tables over charts.

<h2>Detailed Analysis</h2>
Deep-dive per topic. Every subsection with ≥2 data points needs a complete table.
If geospatial data exists, include a full coordinates table with all available points and
columns for lat/lon and metadata (never omit rows).
Use HTML tables only (no diagrams or charts).
If mining concession data exists, include a section titled exactly:
<h3>Mining Concessions Table</h3> followed by an HTML table.

<h2>Conclusions</h2>
Synthesis and forward-looking perspective.

<h2>References</h2>
Sources mentioned in the conversation as a clean <ul> or <table>.

Generate a complete, data-rich professional report with all visualisations embedded inline.`;

    console.log('🤖 Server: Sending request to OpenAI API (GPT-4o)...');
    console.log('🤖 Server: Prompt length:', userPrompt.length);

    // ─────────────────────────────────────────────────────────────────────────
    // RETRY LOOP
    // ─────────────────────────────────────────────────────────────────────────
    const MAX_RETRIES = 3;
    const INITIAL_DELAY = 2000;
    let lastError = null;
    let response = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          const delay = INITIAL_DELAY * Math.pow(2, attempt - 1);
          console.log(`🔄 Server: Retry ${attempt + 1}/${MAX_RETRIES + 1} after ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }

        response = await fetch(OPENAI_CONFIG.API_BASE, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: OPENAI_CONFIG.MODEL,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            temperature: 0.6,
            max_tokens: 16384,
          }),
        });

        if (response.ok) break;

        if (response.status === 429) {
          lastError = { status: 429, message: 'Rate limit exceeded.', retryable: true };
          console.warn(`⚠️ Server: 429 on attempt ${attempt + 1}, retrying...`);
          if (attempt === MAX_RETRIES) {
            throw new Error(
              `Rate limit exceeded after ${MAX_RETRIES + 1} attempts. Please wait and try again.`,
            );
          }
          continue;
        }

        // Non-retryable error
        const errorData = await response.text();
        let errorMessage = errorData;
        let errorDetails = {};
        try {
          const errorJson = JSON.parse(errorData);
          errorMessage = errorJson.error?.message || errorJson.message || JSON.stringify(errorJson);
          errorDetails = errorJson.error || errorJson;
        } catch (_) {}
        console.error('❌ Server: OpenAI API Error:', response.status, errorMessage);
        return res.status(500).json({
          error: `OpenAI API error: ${response.status}`,
          message: errorMessage,
          details: errorDetails,
          retryable: false,
        });
      } catch (error) {
        if (attempt === MAX_RETRIES) {
          console.error('❌ Server: OpenAI API failed after all retries:', error);
          return res
            .status(500)
            .json({ error: 'OpenAI API request failed', message: error.message, retryable: false });
        }
        lastError = error;
      }
    }

    if (!response || !response.ok) {
      return res.status(500).json({
        error: 'OpenAI API request failed',
        details: lastError?.message || 'Unknown error',
        retryable: lastError?.retryable || false,
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROCESS RESPONSE
    // ─────────────────────────────────────────────────────────────────────────
    const data = await response.json();
    console.log('🤖 Server: OpenAI response received');

    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      console.error('❌ Server: Invalid response format:', data);
      return res
        .status(500)
        .json({ error: 'Invalid response format from OpenAI API', details: data });
    }

    let generatedContent = data.choices[0].message.content;

    // Strip any accidental full-document wrappers or markdown fences
    generatedContent = generatedContent
      .replace(/<!DOCTYPE[^>]*>/gi, '')
      .replace(/<html[^>]*>/gi, '')
      .replace(/<\/html>/gi, '')
      .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
      .replace(/<body[^>]*>/gi, '')
      .replace(/<\/body>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/```html\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim();

    // Ensure concessions table exists whenever coordinate-like concession data is present.
    const reportContextText = `${combinedContent}\n${allConversationText}`;
    const hasConcessionsContext = /concesi[oó]n(?:es|\(es\))?\s+minera(?:s|\(s\))?/i.test(
      reportContextText,
    );
    const concessionsTable = hasConcessionsContext
      ? buildConcessionsTableFromChatSummary(allConversationText) ||
        buildMiningConcessionsTable(reportContextText, mapSnapshots)
      : null;
    const hasConcessionsTable =
      /<h3[^>]*>\s*Tabla de Concesiones Mineras\s*<\/h3>[\s\S]*?<table/i.test(generatedContent);

    if (hasConcessionsContext && concessionsTable && !hasConcessionsTable) {
      const analysisHeadingPattern = /<h2[^>]*>\s*Análisis Detallado\s*<\/h2>/i;
      if (analysisHeadingPattern.test(generatedContent)) {
        generatedContent = generatedContent.replace(
          analysisHeadingPattern,
          (m) => `${m}\n${concessionsTable}`,
        );
      } else {
        generatedContent += `\n<h2>Análisis Detallado</h2>\n${concessionsTable}`;
      }
    }

    // Hard-remove model-generated diagrams/charts we do not want.
    generatedContent = generatedContent
      .replace(/<div[^>]*class=["'][^"']*mermaid[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '')
      .replace(/<svg[\s\S]*?<\/svg>/gi, '')
      .replace(/<h[23][^>]*>\s*Evaluación Geoespacial\s*<\/h[23]>/gi, '')
      .replace(/<figure[\s\S]*?<\/figure>/gi, (figureHtml) => {
        // Keep map snapshot images, remove non-image chart figures.
        return /<img/i.test(figureHtml) ? figureHtml : '';
      });

    // ── Inject map snapshot figures ─────────────────────────────────────────
    // Build <figure> blocks from captured map screenshots and insert them right
    // after the "Hallazgos Clave" heading (or at the top if not found).
    if (mapSnapshots.length > 0) {
      const figureBlocks = mapSnapshots
        .map((msg, i) => {
          const snap = msg.mapSnapshot;
          const caption = snap.place
            ? `Figura ${i + 1}: Vista del mapa — ${snap.place}${
                snap.count
                  ? ` (${snap.count} concesión${snap.count !== 1 ? 'es' : ''}, radio ${
                      snap.radiusKm ?? '?'
                    } km)`
                  : ''
              }`
            : `Figura ${i + 1}: Vista del mapa geoespacial`;
          const imgSrc = snap.url || snap.dataUrl;
          return `<figure style="margin:28px 0;text-align:center;page-break-inside:avoid;">
  <img src="${imgSrc}" alt="${caption}" style="width:100%;max-width:680px;border:1px solid #ddd;border-radius:8px;display:block;margin:0 auto;" />
  <figcaption style="font-size:12px;color:#666;margin-top:8px;">${caption}</figcaption>
</figure>`;
        })
        .join('\n');

      const insertMarker = /<h2[^>]*>\s*Hallazgos[^<]*<\/h2>/i;
      if (insertMarker.test(generatedContent)) {
        generatedContent = generatedContent.replace(
          insertMarker,
          (match) => `${match}\n${figureBlocks}`,
        );
      } else {
        // Fallback: prepend before first <h2>
        const firstH2 = generatedContent.indexOf('<h2');
        if (firstH2 > 0) {
          generatedContent = `${generatedContent.slice(
            0,
            firstH2,
          )}${figureBlocks}\n${generatedContent.slice(firstH2)}`;
        } else {
          generatedContent = figureBlocks + '\n' + generatedContent;
        }
      }
    }

    // ── Inject deep-analysis Plotly chart iframes ──────────────────────────
    // Append each chart as an <iframe> using a base64 data URI so the Plotly
    // JavaScript inside the HTML runs correctly without any escaping issues.
    if (analysisPanels.length > 0) {
      const chartBlocks = analysisPanels
        .map((panel) => {
          const b64 = Buffer.from(panel.html, 'utf-8').toString('base64');
          return `<div style="margin:28px 0;page-break-inside:avoid;">
  <h3 style="margin-bottom:8px;">${panel.index}. ${panel.title || ''}</h3>
  <iframe
    src="data:text/html;base64,${b64}"
    title="${(panel.title || '').replace(/"/g, '&quot;')}"
    sandbox="allow-scripts allow-same-origin"
    style="width:100%;height:520px;border:1px solid #ddd;border-radius:8px;display:block;"
    loading="lazy"
  ></iframe>
</div>`;
        })
        .join('\n');

      generatedContent += `\n<h2>Deep Analysis Charts</h2>\n${chartBlocks}`;
      console.log(
        `📊 Server: Injected ${analysisPanels.length} analysis panel iframe(s) into report.`,
      );
    }

    console.log('✅ Server: Report generated successfully, length:', generatedContent.length);

    res.status(200).json({
      success: true,
      report: {
        title: 'POLISENSE.AI REPORT',
        content: generatedContent,
        generatedAt: new Date().toISOString(),
        source: 'GPT-4o',
        conversationLength: normalizedConversation.length,
      },
    });
  } catch (error) {
    console.error('❌ Server: Report generation failed:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
}
