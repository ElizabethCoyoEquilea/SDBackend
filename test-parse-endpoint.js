#!/usr/bin/env node

/**
 * Script de prueba para el endpoint de parsing de imágenes
 * 
 * Uso:
 *   node test-parse-endpoint.js <ruta-a-imagen>
 * 
 * Ejemplo:
 *   node test-parse-endpoint.js ./test-diagram.jpg
 */

const fs = require('fs');
const path = require('path');

async function testParseEndpoint(imagePath) {
  const FormData = require('form-data');
  const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

  if (!fs.existsSync(imagePath)) {
    console.error(`❌ Error: La imagen no existe: ${imagePath}`);
    process.exit(1);
  }

  const form = new FormData();
  form.append('image', fs.createReadStream(imagePath));
  form.append('lang', 'es');
  form.append('useLLM', 'true');

  console.log('📤 Enviando imagen al endpoint...');
  console.log(`   Archivo: ${path.basename(imagePath)}`);
  console.log(`   Tamaño: ${(fs.statSync(imagePath).size / 1024).toFixed(2)} KB`);
  console.log('');

  try {
    const startTime = Date.now();
    
    const response = await fetch('http://localhost:3000/api/parse/diagram', {
      method: 'POST',
      body: form,
      headers: form.getHeaders()
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      console.error(`❌ Error ${response.status}:`, error.error || error.message);
      process.exit(1);
    }

    const result = await response.json();
    
    console.log(`✅ Respuesta recibida en ${elapsed}s`);
    console.log('');
    console.log('📊 Resumen del Diagrama:');
    console.log(`   ID: ${result.diagram.id}`);
    console.log(`   Nombre: ${result.diagram.name}`);
    console.log(`   Entidades: ${result.diagram.entities?.length || 0}`);
    console.log(`   Relaciones: ${result.diagram.relations?.length || 0}`);
    console.log('');
    
    if (result.meta) {
      console.log('🤖 Metadata:');
      console.log(`   Engine: ${result.meta.engine}`);
      if (result.meta.model) console.log(`   Model: ${result.meta.model}`);
      console.log('');
    }

    if (result.diagram.entities && result.diagram.entities.length > 0) {
      console.log('📦 Entidades detectadas:');
      result.diagram.entities.forEach((entity, i) => {
        console.log(`   ${i + 1}. ${entity.name}`);
        if (entity.attributes && entity.attributes.length > 0) {
          console.log(`      Atributos: ${entity.attributes.length}`);
          entity.attributes.slice(0, 3).forEach(attr => {
            const key = attr.isKey ? ' 🔑' : '';
            console.log(`        - ${attr.visibility} ${attr.name}: ${attr.type}${key}`);
          });
          if (entity.attributes.length > 3) {
            console.log(`        ... y ${entity.attributes.length - 3} más`);
          }
        }
      });
      console.log('');
    }

    if (result.diagram.relations && result.diagram.relations.length > 0) {
      console.log('🔗 Relaciones detectadas:');
      result.diagram.relations.forEach((rel, i) => {
        const sourceEntity = result.diagram.entities.find(e => e.id === rel.source);
        const targetEntity = result.diagram.entities.find(e => e.id === rel.target);
        console.log(`   ${i + 1}. ${sourceEntity?.name || rel.source} --${rel.type}--> ${targetEntity?.name || rel.target}`);
        if (rel.sourceCardinality && rel.targetCardinality) {
          console.log(`      Cardinalidad: ${rel.sourceCardinality.label || '1'} - ${rel.targetCardinality.label || '1'}`);
        }
      });
      console.log('');
    }

    // Guardar resultado completo en archivo JSON
    const outputPath = path.join(path.dirname(imagePath), 'parse-result.json');
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
    console.log(`💾 Resultado completo guardado en: ${outputPath}`);

  } catch (error) {
    console.error('❌ Error al procesar:', error.message);
    if (error.cause) console.error('   Causa:', error.cause);
    process.exit(1);
  }
}

// Ejecutar
const imagePath = process.argv[2];

if (!imagePath) {
  console.log('Uso: node test-parse-endpoint.js <ruta-a-imagen>');
  console.log('');
  console.log('Ejemplo:');
  console.log('  node test-parse-endpoint.js ./diagrams/mi-diagrama.jpg');
  process.exit(1);
}

testParseEndpoint(imagePath);
