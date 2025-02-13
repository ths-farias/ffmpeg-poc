'use strict';

const express = require('express');
const fs = require('fs');
const multer = require('multer');
const formatVideoM3u8 = require('./index');

const upload = multer(); // Usa memoryStorage por padrão

const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Servir arquivos locais convertidos e a página HTML
app.use('/hls', express.static('.hls'));
app.use(express.static('public')); // Para servir index.html e outros arquivos da pasta 'public'

// Definir se o vídeo será armazenado localmente ou enviado ao S3
const STORE_LOCALLY = process.env.STORE_LOCALLY === 'true';

app.post('/upload', upload.single('video'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'Nenhum arquivo enviado' });
    }

    // Criar pasta .hls se não existir
    if (!fs.existsSync('.hls')) {
        fs.mkdirSync('.hls', { recursive: true });
    }

    // Gerar nome único para o arquivo de entrada
    const uniqueId = Date.now();
    const inputFileName = `.hls/input_${uniqueId}.mp4`;

    fs.writeFile(inputFileName, req.file.buffer, (err) => {
        if (err) {
            return res.status(500).json({ error: 'Erro ao salvar o vídeo' });
        }
        // Passa a opção de armazenamento para a função de conversão
        formatVideoM3u8(inputFileName, res, STORE_LOCALLY);
    });
});

app.listen(3000, () => {
    console.log('Server is running on port 3000');
});
