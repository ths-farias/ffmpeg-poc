'use-strict'
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

const formatVideoM3u8 = (inputFilePath, res) => {
    // Derivar um nome único para o arquivo de saída
    const baseName = path.basename(inputFilePath, path.extname(inputFilePath));
    const outputFilePath = `./hls/${baseName}.m3u8`;

    ffmpeg(inputFilePath)
        .outputOptions([
            '-c:v copy',
            '-c:a copy',
            '-start_number 0',
            '-hls_time 6',
            '-hls_list_size 0',
            '-hls_playlist_type vod'
        ])
        .output(outputFilePath)
        .on('end', () => {
            console.log('Conversão concluída!');
            // Enviar o arquivo convertido para o S3 usando AWS SDK v3
            fs.readFile(outputFilePath, (readErr, fileData) => {
                if (readErr) {
                    console.error('Erro ao ler o arquivo:', readErr);
                    return res.status(500).json({ error: 'Erro ao ler o arquivo convertido' });
                }
                const params = {
                    Bucket: bucketName,
                    Key: `hls/${baseName}.m3u8`,
                    Body: fileData,
                    ContentType: 'application/vnd.apple.mpegurl'
                };
                s3.send(new PutObjectCommand(params))
                    .then(() => {
                        console.log('Upload realizado com sucesso');
                        // Gerar URL assinada para consulta do arquivo
                        getSignedUrl(s3, new GetObjectCommand({ Bucket: bucketName, Key: params.Key }), { expiresIn: 3600 })
                            .then((signedUrl) => {
                                // Deletar o arquivo de entrada e arquivos gerados na pasta hls que iniciem com baseName
                                Promise.all([
                                    new Promise(resolve => {
                                        fs.unlink(inputFilePath, (unlinkInputErr) => {
                                            if (unlinkInputErr) {
                                                console.error('Erro ao deletar o arquivo de entrada:', unlinkInputErr);
                                            }
                                            resolve();
                                        });
                                    }),
                                    new Promise(resolve => {
                                        fs.readdir('./hls', (readdirErr, files) => {
                                            if (readdirErr) {
                                                console.error('Erro ao ler a pasta hls:', readdirErr);
                                                return resolve();
                                            }
                                            const filesToDelete = files.filter(file => file.startsWith(baseName));
                                            let deletePromises = filesToDelete.map(file => {
                                                return new Promise(r => {
                                                    fs.unlink(`./hls/${file}`, (err) => {
                                                        if (err) {
                                                            console.error(`Erro ao deletar ${file}:`, err);
                                                        }
                                                        r();
                                                    });
                                                });
                                            });
                                            Promise.all(deletePromises).then(resolve);
                                        });
                                    })
                                ]).then(() => {
                                    res.json({ message: 'Vídeo processado e enviado para S3 com sucesso', endpoint: signedUrl });
                                });
                            })
                            .catch((err) => {
                                console.error('Erro ao gerar URL assinada:', err);
                                res.status(500).json({ error: 'Erro ao gerar URL de acesso' });
                            });
                    })
                    .catch((uploadErr) => {
                        console.error('Erro no upload para S3:', uploadErr);
                        res.status(500).json({ error: 'Erro ao enviar o arquivo para S3' });
                    });
            });
        })
        .on('error', (err) => {
            console.error('Erro durante a conversão:', err);
            res.status(500).json({ error: 'Erro ao processar o vídeo' });
        })
        .run();
}

module.exports = formatVideoM3u8;