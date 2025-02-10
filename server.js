'use-strict'

const express = require('express');
const fs = require('fs');
const multer = require('multer');
const formatVideoM3u8 = require('./index')

const upload = multer(); // usa memoryStorage por padrão

const app = express();

app.use(express.json({ limit: '50mb' })); // Increase the limit if needed
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.post('/upload', upload.single('video'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'Nenhum arquivo enviado' });
    }
    // Gerar nome único para o arquivo de entrada
    const uniqueId = Date.now();
    const inputFileName = `input_${uniqueId}.mp4`;
    fs.writeFile(inputFileName, req.file.buffer, (err) => {
        if (err) {
            return res.status(500).json({ error: 'Erro ao salvar o vídeo' });
        }
        // Passa o nome único para a função de conversão
        formatVideoM3u8(inputFileName, res);
    });
});

app.listen(3000, () => {
    console.log('Server is running on port 3000');
});