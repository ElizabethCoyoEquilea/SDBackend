const fs = require('fs');
const path = require('path');
// Nota: evitamos dependencias adicionales como 'zod' para no requerir instalación.
// Usaremos validaciones ligeras (defensive checks) más abajo.

// KISS: Por ahora implementamos una llamada local que intenta usar una variable
// de entorno para elegir provider. Si NO existe, hacemos un enfoque simple:
//  - Guardamos la imagen temporalmente y devolvemos un diagrama simple por defecto
//  - Esto se puede reemplazar con la integración de Gemini/GPT más adelante

const fetch = require('node-fetch');

// Utilidades de validación simple
function ensureString(v, fallback = '') { return (typeof v === 'string') ? v : fallback; }
function ensureBoolean(v, fallback = false) { return (typeof v === 'boolean') ? v : fallback; }
function ensureNumber(v, fallback = 0) { return (typeof v === 'number' && Number.isFinite(v)) ? v : fallback; }
function asArray(v) { return Array.isArray(v) ? v : []; }
function sanitizeAttribute(attr, now, idx) {
  return {
    id: ensureString(attr?.id, `attr-${now}-${idx}`),
    name: ensureString(attr?.name, 'atributo'),
    type: ensureString(attr?.type, 'String'),
    visibility: ensureString(attr?.visibility, 'private'),
    isKey: ensureBoolean(attr?.isKey, false),
    ...attr
  };
}
function sanitizeEntity(entity, now, idx) {
  const attributes = asArray(entity?.attributes).map((a, i) => sanitizeAttribute(a, now, `${idx}-${i}`));
  return {
    id: ensureString(entity?.id, `entity-${now}-${idx}`),
    name: ensureString(entity?.name, `Entidad${idx}`),
    type: ensureString(entity?.type, 'class'),
    attributes,
    methods: asArray(entity?.methods),
    position: {
      x: ensureNumber(entity?.position?.x, 100 + (idx % 3) * 300),
      y: ensureNumber(entity?.position?.y, 100 + Math.floor(idx / 3) * 250)
    },
    ...entity
  };
}
function sanitizeRelation(rel, now, idx) {
  return {
    id: ensureString(rel?.id, `rel-${now}-${idx}`),
    source: ensureString(rel?.source, ''),
    target: ensureString(rel?.target, ''),
    type: ensureString(rel?.type, 'association'),
    label: rel?.label ?? '',
    ...rel
  };
}
function sanitizeDiagram(diagram) {
  const now = Date.now();
  const entities = asArray(diagram?.entities).map((e, i) => sanitizeEntity(e, now, i));
  const relations = asArray(diagram?.relations).map((r, i) => sanitizeRelation(r, now, i));
  return {
    id: ensureString(diagram?.id, `import-${now}`),
    name: ensureString(diagram?.name, 'Diagrama importado'),
    entities,
    relations,
    ...diagram
  };
}


async function analyzeImage(buffer, options = {}) {
  const rawKey = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY || '';
  const providerKey = rawKey.replace(/^["']|["']$/g, '').trim();
  const providerUrl = (process.env.OPENAI_API_URL || 'https://api.openai.com/v1/chat/completions').trim();
  const modelName = 'gpt-4o-mini';

  console.log('[llmClient] Checking configuration...');
  console.log('[llmClient] OPENAI_API_KEY exists:', !!providerKey);
  console.log('[llmClient] OPENAI_API_KEY length:', providerKey ? providerKey.length : 0);
  console.log('[llmClient] OPENAI_API_URL:', providerUrl);
  console.log('[llmClient] OPENAI_MODEL:', modelName);

  // Si no está configurado un proveedor remoto, usar fallback simple
  if (!providerKey || !providerUrl) {
    console.warn('[llmClient] API not configured, using FALLBACK mock data');
    const now = Date.now();
    const diagram = {
      id: `import-${now}`,
      name: `Diagrama importado ${new Date(now).toISOString()}`,
      entities: [
        {
          id: `entity-${now}-1`,
          name: 'Usuario',
          type: 'class',
          attributes: [
            { id: `attr-${now}-1-1`, name: 'id', type: 'String', visibility: 'private', isKey: true },
            { id: `attr-${now}-1-2`, name: 'nombre', type: 'String', visibility: 'private' },
            { id: `attr-${now}-1-3`, name: 'apellido', type: 'String', visibility: 'private' },
            { id: `attr-${now}-1-4`, name: 'email', type: 'String', visibility: 'private' }
          ],
          methods: [],
          position: { x: 100, y: 100 }
        }
      ],
      relations: []
    };

    return { diagram, meta: { engine: 'fallback-mock' } };
  }

  // Convertir buffer a base64 para enviar la imagen a OpenAI
  const b64 = buffer.toString('base64');
  const mimeType = (options && options.mimeType) ? options.mimeType : 'image/jpeg';
  console.log('[llmClient] Using mimeType:', mimeType);

  // Prompt mejorado y más específico para diagramas UML
  const timestamp = Date.now();
  const prompt = `Eres un experto en diagramas UML. Analiza esta imagen que contiene un DIAGRAMA UML DE CLASES.

IMPORTANTE: Esta es una imagen de un diagrama UML, NO una tabla de base de datos ni un simple esquema.

INSTRUCCIONES:
1. Identifica TODAS las clases/entidades (son los rectángulos con nombre en la parte superior)
2. Para cada clase, extrae:
   - El nombre de la clase (está en el encabezado del rectángulo)
   - TODOS los atributos listados (busca los signos +, -, # que indican visibilidad)
   - El tipo de cada atributo (puede estar después de ":" o ser inferido)
3. Identifica TODAS las lineas/flechas que conectan las clases (estas son RELACIONES)
   - Linea simple = association
   - Diamante vacio = aggregation  
   - Diamante relleno = composition
   - Flecha con triángulo vacio = inheritance
   - Linea punteada = dependency
4. Extrae las cardinalidades cerca de las lineas (1, 1..1, 1..*, 0..*, *, etc.)

RESPONDE SOLO CON UN JSON VALIDO (sin \`\`\`json, sin explicaciones, sin comentarios):

{
  "id": "import-${timestamp}",
  "name": "Diagrama importado",
  "entities": [
    {
      "id": "entity-${timestamp}-1",
      "name": "NombreDeLaClase",
      "type": "class",
      "attributes": [
        {
          "id": "attr-${timestamp}-1-1",
          "name": "nombreAtributo",
          "type": "String",
          "visibility": "private",
          "isKey": false
        }
      ],
      "methods": [],
      "position": { "x": 100, "y": 100 }
    }
  ],
  "relations": [
    {
      "id": "rel-${timestamp}-1",
      "source": "entity-${timestamp}-1",
      "target": "entity-${timestamp}-2",
      "type": "association",
      "sourceCardinality": { "min": 1, "max": 1, "label": "1" },
      "targetCardinality": { "min": 0, "max": "unlimited", "label": "0..*" },
      "isNavigable": { "source": true, "target": true }
    }
  ]
}

REGLAS ESTRICTAS:
- Visibilidad: + = public, - = private, # = protected, ~ = package
- Si ves "id" o un atributo con 🔑 o "PK", marca isKey: true
- Tipos comunes: String, Integer, Long, Date, Boolean, Double
- SIEMPRE incluye las relaciones si hay líneas conectando clases
- Position: distribuye las clases cada 300px en x, cada 250px en y
- NO inventes datos que no estén en la imagen
- Si no estás seguro de un tipo, usa "String"

JSON:`;

  const openaiPayload = {
    model: modelName,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${b64}`
            }
          }
        ]
      }
    ],
    max_tokens: 4000,
    response_format: { type: 'json_object' }
  };

  try {
    console.log('[llmClient] 🚀 Calling OpenAI vision API...');
    console.log('[llmClient] Image size:', (b64.length / 1024).toFixed(2), 'KB (base64)');
    
    const resp = await fetch(providerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${providerKey}`
      },
      body: JSON.stringify(openaiPayload),
      timeout: 120000
    });

    console.log('[llmClient] OpenAI response status:', resp.status);

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`OpenAI API error: ${resp.status} ${text}`);
    }

    const data = await resp.json();
    
    let textResponse = data.choices?.[0]?.message?.content;
    if (!textResponse) {
      throw new Error('No text in OpenAI response');
    }

    // Limpiar markdown y otros caracteres extraños
    textResponse = textResponse
      .replace(/```json\s*/g, '')
      .replace(/```\s*/g, '')
      .replace(/^JSON:\s*/i, '')
      .trim();
    
    // Buscar el objeto JSON si hay texto antes/después
    const jsonMatch = textResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      textResponse = jsonMatch[0];
    }
    
    console.log('[llmClient] Raw response length:', textResponse.length);
    console.log('[llmClient] First 200 chars:', textResponse.substring(0, 200));
    
    // Parsear JSON
    let diagram;
    try {
      diagram = JSON.parse(textResponse);
    } catch (parseError) {
      console.error('[llmClient] JSON Parse Error:', parseError.message);
      console.error('[llmClient] Failed to parse:', textResponse.substring(0, 500));
      throw new Error(`Invalid JSON from OpenAI: ${parseError.message}`);
    }
    
    // Sanitizar estructura con validadores ligeros
    const sanitized = sanitizeDiagram(diagram);
    console.log(`[llmClient] Successfully parsed: ${sanitized.entities.length} entities, ${sanitized.relations.length} relations`);
    
    return { 
      diagram: sanitized, 
      meta: { 
        engine: 'openai-vision',
        model: modelName,
        rawResponse: textResponse.substring(0, 1000) // Limitar para no saturar logs
      } 
    };
  } catch (err) {
    console.error('Error calling LLM provider:', err);
    // Fallback: devolver mock para no bloquear la integración
    const now = Date.now();
    const diagram = {
      id: `import-${now}`,
      name: `Diagrama importado ${new Date(now).toISOString()}`,
      entities: [
        {
          id: `entity-${now}-1`,
          name: 'Usuario',
          type: 'class',
          attributes: [
            { id: `attr-${now}-1-1`, name: 'id', type: 'String', visibility: 'private', isKey: true },
            { id: `attr-${now}-1-2`, name: 'nombre', type: 'String', visibility: 'private' }
          ],
          methods: [],
          position: { x: 100, y: 100 }
        }
      ],
      relations: []
    };

    return { diagram, meta: { engine: 'fallback-mock', error: err.message } };
  }
}

module.exports = { analyzeImage };
