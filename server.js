'use strict';

const express = require('express');
const fs = require('fs');
const multer = require('multer');
const formatVideoM3u8 = require('./index');
const upload = multer(); 
const app = express();

app.use(express.json({ limit: '1gb' }));
app.use(express.urlencoded({ extended: true, limit: '1gb' }));
app.use('/hls', express.static('.hls'));
app.use(express.static('public')); 

const STORE_LOCALLY = process.env.STORE_LOCALLY === 'true';

app.post('/upload', upload.single('video'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'Nenhum arquivo enviado' });
    }
    
    if (!fs.existsSync('.hls')) {
        fs.mkdirSync('.hls', { recursive: true });
    }
    
    const uniqueId = Date.now();
    const inputFileName = `.hls/input_${uniqueId}.mp4`;

    fs.writeFile(inputFileName, req.file.buffer, (err) => {
        if (err) {
            return res.status(500).json({ error: 'Erro ao salvar o vídeo' });
        }
        
        formatVideoM3u8(inputFileName, res, STORE_LOCALLY);
    });
});

const server = app.listen(3000, () => {
    console.log('Server is running on port 3000');
});

server.timeout = 600000; 
