// Script de prueba rápida para verificar la conexión con Gemini
require('dotenv').config();
const fetch = require('node-fetch');

async function testGemini() {
  const apiKey = process.env.LLM_API_KEY;
  const apiUrl = process.env.LLM_API_URL ? process.env.LLM_API_URL.trim() : null;

  console.log('=== TEST DE CONFIGURACIÓN GEMINI ===\n');
  console.log('LLM_API_KEY:', apiKey ? `✅ Configurada (${apiKey.length} caracteres)` : '❌ NO configurada');
  console.log('LLM_API_URL:', apiUrl ? `✅ ${apiUrl}` : '❌ NO configurada');
  console.log('\n');

  if (!apiKey || !apiUrl) {
    console.error('❌ ERROR: Falta configuración en .env');
    process.exit(1);
  }

  // Crear una imagen simple de prueba (1x1 pixel rojo en base64)
  const testImageBase64 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA8=';

  const payload = {
    contents: [{
      role: 'user',
      parts: [
        { text: 'Describe esta imagen en una palabra.' },
        {
          inlineData: {
            mimeType: 'image/jpeg',
            data: testImageBase64
          }
        }
      ]
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 100,
    }
  };

  try {
    console.log('🚀 Enviando petición a Gemini...\n');
    
    const url = `${apiUrl}?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    console.log('Status:', response.status, response.statusText);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('\n❌ ERROR en la respuesta:');
      console.error(errorText);
      process.exit(1);
    }

    const data = await response.json();
    
    console.log('\n✅ Respuesta exitosa de Gemini:');
    console.log('Candidates:', data.candidates ? data.candidates.length : 0);
    
    if (data.candidates && data.candidates[0]) {
      const text = data.candidates[0]?.content?.parts?.[0]?.text;
      console.log('Texto de respuesta:', text);
    }

    console.log('\n✅ ¡TODO FUNCIONÓ CORRECTAMENTE!');
    console.log('Gemini está respondiendo correctamente.');
    
  } catch (error) {
    console.error('\n❌ ERROR al hacer la petición:');
    console.error(error.message);
    if (error.cause) console.error('Causa:', error.cause);
    process.exit(1);
  }
}

testGemini();
