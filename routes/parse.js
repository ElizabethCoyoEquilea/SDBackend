const express = require('express');
const multer = require('multer');
const parseController = require('../controllers/parseController');

const router = express.Router();

// Usar multer en memoria para evitar escritura en disco (puedes cambiar a S3 si quieres)
const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 8 * 1024 * 1024 } }); // 8 MB

router.post('/diagram', upload.single('image'), parseController.parse);

module.exports = router;
