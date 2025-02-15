'use strict';

const express = require('express');
const fs = require('fs');
const multer = require('multer');
const formatVideoM3u8 = require('./index');
const upload = multer();
const app = express();

app.use(express.json({ limit: '1gb' }));
app.use(express.urlencoded({ extended: true, limit: '1gb' }));

app.post('/upload', upload.single('video'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'Nenhum arquivo enviado' });
    }

    const token = req.headers['x-token'];
    if (!token) {
        return res.status(400).json({ message: 'Token é obrigatório' });
    }

    const uniqueId = Date.now();
    const inputFileName = `.temp/input_${uniqueId}.mp4`;

    fs.writeFile(inputFileName, req.file.buffer, (err) => {
        if (err) {
            return res.status(500).json({ error: 'Erro ao salvar o vídeo' });
        }

        res.json({
            message: 'O arquivo foi recebido e será processado.',
            status: 'processing'
        });

        formatVideoM3u8(inputFileName, res, token);
    });
});

const server = app.listen(3000, () => {
    console.log('Server is running on port 3000');
});

server.timeout = 600000;
