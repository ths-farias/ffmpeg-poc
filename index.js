'use strict';
const fs = require('fs');
const path = require('path');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffmpeg = require('fluent-ffmpeg');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');

ffmpeg.setFfmpegPath(ffmpegPath);

require("dotenv").config();

const resolutions = [
    { name: "480p", width: 854, height: 480, bitrate: "800k" },
    { name: "720p", width: 1280, height: 720, bitrate: "2500k" },
    { name: "1080p", width: 1920, height: 1080, bitrate: "5000k" },
];

const formatVideoM3u8 = (inputFilePath, res) => {
    const baseName = path.basename(inputFilePath, path.extname(inputFilePath));
    const outputDir = '.hls';

    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    let conversionPromises = resolutions.map(resolution => {
        return new Promise((resolve, reject) => {
            const outputResFile = `${outputDir}/${baseName}_${resolution.name}.m3u8`;
            const outputSegmentFile = `${outputDir}/${baseName}_${resolution.name}_%03d.ts`;

            console.log(`🎥 Convertendo para ${resolution.name}...`);

            ffmpeg(inputFilePath)
                .outputOptions([
                    `-c:v libx264`,
                    `-b:v ${resolution.bitrate}`,
                    `-preset veryfast`,
                    `-g 48`,
                    `-sc_threshold 0`,
                    `-hls_time 6`,
                    `-hls_list_size 0`,
                    `-hls_segment_filename ${outputSegmentFile}`,
                    `-hls_flags independent_segments`
                ])
                .size(`${resolution.width}x${resolution.height}`)
                .output(outputResFile)
                .on('end', () => {
                    console.log(`✅ Resolução ${resolution.name} concluída!`);
                    resolve(outputResFile);
                })
                .on('error', (err) => {
                    console.error(`❌ Erro ao converter ${resolution.name}:`, err);
                    reject(err);
                })
                .run();
        });
    });

    Promise.all(conversionPromises)
        .then(() => uploadHLSFiles(baseName, res))
        .catch((err) => {
            console.error('❌ Erro ao converter o vídeo:', err);
            res.status(500).json({ error: 'Erro ao processar o vídeo' });
        });
};

async function uploadHLSFiles(baseName, res) {
    const outputDir = '.hls';
    let filesToUpload = [];

    const masterPlaylistPath = `${outputDir}/${baseName}.m3u8`;
    let masterPlaylist = `#EXTM3U\n`;

    resolutions.forEach(resolution => {
        const s3M3U8Url = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/hls/${baseName}_${resolution.name}.m3u8`;
        masterPlaylist += `#EXT-X-STREAM-INF:BANDWIDTH=${parseInt(resolution.bitrate) * 1000},RESOLUTION=${resolution.width}x${resolution.height}\n`;
        masterPlaylist += `${s3M3U8Url}\n`;
    });

    masterPlaylist += "#EXT-X-ENDLIST\n";
    fs.writeFileSync(masterPlaylistPath, masterPlaylist);

    console.log(`✅ Master playlist gerada: ${masterPlaylistPath}`);

    fs.readdirSync(outputDir).forEach(file => {
        if (file.startsWith(baseName)) {
            filesToUpload.push({ local: `${outputDir}/${file}`, s3Key: `hls/${file}` });
        }
    });

    try {
        const s3Urls = {};
        for (const file of filesToUpload) {
            const fileUrl = await uploadFile(file.s3Key, file.local);
            s3Urls[file.local] = fileUrl;
        }

        console.log('📤 Todos os arquivos enviados para S3');

        const finalM3U8Url = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/hls/${baseName}.m3u8`;

        console.log(`🎥 Vídeo final disponível em: ${finalM3U8Url}`);
        
        cleanupLocalFiles(outputDir, baseName);

        res.json({ message: 'Vídeo processado e enviado para S3 com sucesso', videoUrl: finalM3U8Url });
    } catch (error) {
        console.error('❌ Erro no upload dos arquivos:', error);
        res.status(500).json({ error: 'Erro ao enviar arquivos para S3' });
    }
}


async function uploadFile(s3Key, filePath) {
    try {
        if (!fs.existsSync(filePath)) {
            throw new Error(`❌ Arquivo não encontrado: ${filePath}`);
        }
        const s3 = new S3Client({
            region: process.env.AWS_REGION,
            credentials: {
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
                accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            }
        });
        const fileContent = fs.readFileSync(filePath);

        const params = {
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: s3Key,
            Body: fileContent
        };
        console.log(`Bucket ${process.env.AWS_BUCKET_NAME}`);
        console.log(`📤 Enviando ${s3Key} para o S3...`);
        await s3.send(new PutObjectCommand(params));

        const fileUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`;
        console.log(`✅ Upload concluído: ${fileUrl}`);
        return fileUrl;
    } catch (error) {
        console.error(`❌ Erro no upload de ${s3Key}:`, error);
        throw error;
    }
}

function cleanupLocalFiles(outputDir, baseName) {
    try {
        fs.readdirSync(outputDir).forEach(file => {
            if (file.startsWith(baseName)) {
                const filePath = path.join(outputDir, file);
                fs.unlinkSync(filePath);
                console.log(`🗑️ Removido: ${filePath}`);
            }
        });

        console.log('🧹 Limpeza de arquivos locais concluída!');
    } catch (error) {
        console.error('❌ Erro ao remover arquivos locais:', error);
    }
}

module.exports = formatVideoM3u8;
