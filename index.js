'use strict';
const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffmpeg = require('fluent-ffmpeg');

ffmpeg.setFfmpegPath(ffmpegPath);

// Inicializar S3Client com AWS SDK v3
const s3 = new S3Client({
    region: 'region',
    credentials: {
        secretAccessKey: 'secretAccessKey',
        accessKeyId: 'accessKeyId'
    }
});
const bucketName = 'bucketName';

// Definir as resoluções para gerar
const resolutions = [
    { name: "480p", width: 854, height: 480, bitrate: "800k" },
    { name: "720p", width: 1280, height: 720, bitrate: "2500k" },
    { name: "1080p", width: 1920, height: 1080, bitrate: "5000k" },
];

/**
 * Função para converter vídeo para múltiplas resoluções e gerar um único arquivo .m3u8
 */
const formatVideoM3u8 = (inputFilePath, res, storeLocally = true, uploadToS3 = false) => {
    const baseName = path.basename(inputFilePath, path.extname(inputFilePath));
    const outputDir = '.hls';
    const masterPlaylistPath = path.join(outputDir, `${baseName}.m3u8`);

    // Criar diretório ./hls se não existir
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    let masterPlaylist = `#EXTM3U\n`;

    // Criar uma promessa para cada resolução
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
                    masterPlaylist += `#EXT-X-STREAM-INF:BANDWIDTH=${parseInt(resolution.bitrate) * 1000},RESOLUTION=${resolution.width}x${resolution.height}\n`;
                    masterPlaylist += `${baseName}_${resolution.name}.m3u8\n`;
                    resolve();
                })
                .on('error', (err) => {
                    console.error(`❌ Erro ao converter ${resolution.name}:`, err);
                    reject(err);
                })
                .run();
        });
    });

    // Após a conversão de todas as resoluções, escrever a playlist mestre
    Promise.all(conversionPromises)
        .then(() => {
            masterPlaylist += "#EXT-X-ENDLIST\n";
            fs.writeFileSync(masterPlaylistPath, masterPlaylist);
            console.log(`✅ Playlist mestre criada: ${masterPlaylistPath}`);

            if (storeLocally) {
                console.log(`📂 Vídeo armazenado localmente em ${outputDir}`);
                res.json({ 
                    message: 'Vídeo processado e armazenado localmente',
                    videoUrl: `http://localhost:3000/hls/${baseName}.m3u8`
                });
            }

            if (uploadToS3) {
                uploadMasterPlaylistToS3(masterPlaylistPath, baseName, res);
            }
        })
        .catch((err) => {
            console.error('❌ Erro ao converter o vídeo:', err);
            res.status(500).json({ error: 'Erro ao processar o vídeo' });
        });
};

/**
 * Função para fazer upload do arquivo .m3u8 para o S3
 */
const uploadMasterPlaylistToS3 = (playlistPath, baseName, res) => {
    fs.readFile(playlistPath, (readErr, fileData) => {
        if (readErr) {
            console.error('Erro ao ler a playlist mestre:', readErr);
            return res.status(500).json({ error: 'Erro ao ler a playlist mestre' });
        }
        const params = {
            Bucket: bucketName,
            Key: `hls/${baseName}.m3u8`,
            Body: fileData,
            ContentType: 'application/vnd.apple.mpegurl'
        };
        s3.send(new PutObjectCommand(params))
            .then(() => {
                console.log('✅ Upload da playlist mestre realizado com sucesso');

                getSignedUrl(s3, new GetObjectCommand({ Bucket: bucketName, Key: params.Key }), { expiresIn: 3600 })
                    .then((signedUrl) => {
                        res.json({ message: 'Vídeo processado e enviado para S3 com sucesso', endpoint: signedUrl });
                    })
                    .catch((err) => {
                        console.error('Erro ao gerar URL assinada:', err);
                        res.status(500).json({ error: 'Erro ao gerar URL de acesso' });
                    });
            })
            .catch((uploadErr) => {
                console.error('Erro no upload para S3:', uploadErr);
                res.status(500).json({ error: 'Erro ao enviar a playlist mestre para S3' });
            });
    });
};

module.exports = formatVideoM3u8;
