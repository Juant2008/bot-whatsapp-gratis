const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const http = require('http');

let qrCodeData = ""; // Aquí guardaremos el código para mostrarlo

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// Cuando se genera el QR, lo convertimos a una imagen para la web
client.on('qr', (qr) => {
    qrcode.toDataURL(qr, (err, url) => {
        qrCodeData = url;
        console.log("¡QR actualizado! Refresca la página web.");
    });
});

client.on('ready', () => {
    qrCodeData = "<h1>¡Bot conectado correctamente! Ya puedes cerrar esta página.</h1>";
    console.log('Bot listo');
});

// Creamos un mini servidor web para ver el QR desde el iPhone
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    if (qrCodeData.startsWith("data:image")) {
        res.write(`
            <div style="text-align:center;">
                <h1>Escanea este QR con tu WhatsApp:</h1>
                <img src="${qrCodeData}" style="width:300px; height:300px;">
                <p>Si no carga, refresca la página.</p>
            </div>
        `);
    } else {
        res.write(qrCodeData || "<h1>Generando QR... espera unos segundos y refresca.</h1>");
    }
    res.end();
}).listen(process.env.PORT || 3000);

client.on('message', msg => {
    if (msg.body.toLowerCase() === 'hola') {
        msg.reply('¡Hola! Soy tu bot funcionando desde Render.');
    }
});

client.initialize();
