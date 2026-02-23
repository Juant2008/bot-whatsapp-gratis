<?php include 'include/header.php'; ?>
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const mysql = require('mysql2/promise');
const qrcode = require('qrcode');
const http = require('http');

// --- CONFIGURACIÓN DE CONEXIÓN ---
const genAI = new GoogleGenerativeAI("AIzaSyBklINjYPMv_vXQkF6MW5yMCdaAJyRBrQU"); // Tu API Key [cite: 685]
const dbConfig = { 
    host: 'one4cars.com', 
    user: 'juant200_one4car', 
    password: 'Notieneclave1*', 
    database: 'juant200_venezon' 
};

let socketBot = null;
let qrCodeData = "";

// --- FUNCIONES DE BASE DE DATOS (EL "PODER" DEL BOT) ---

// 1. Consultar Saldo Real [cite: 815]
async function obtenerSaldoCliente(rif) {
    const conn = await mysql.createConnection(dbConfig);
    try {
        const [rows] = await conn.execute(
            "SELECT SUM(total - abono_factura) as saldo FROM tab_facturas WHERE id_cliente = (SELECT id_cliente FROM tab_clientes WHERE cedula = ?) AND pagada = 'NO'", 
            [rif]
        );
        return rows[0].saldo || 0;
    } finally { await conn.end(); }
}

// 2. Consultar Descuento Dinámico [cite: 801, 819]
async function obtenerDescuento(rif) {
    const conn = await mysql.createConnection(dbConfig);
    try {
        const [rows] = await conn.execute(
            "SELECT porcentaje FROM tab_clientes WHERE cedula = ?", 
            [rif]
        );
        if (rows.length > 0) {
            let p = rows[0].porcentaje;
            return Math.round((1 - p) * 100); // 0.6 -> 40%
        }
        return null;
    } finally { await conn.end(); }
}

// 3. Búsqueda Inteligente de Productos 
async function buscarProducto(termino) {
    const conn = await mysql.createConnection(dbConfig);
    try {
        const [rows] = await conn.execute(
            "SELECT descripcion, precio, cantidad_existencia FROM tab_productos WHERE descripcion LIKE ? LIMIT 3", 
            [`%${termino}%`]
        );
        return rows;
    } finally { await conn.end(); }
}

// --- LÓGICA DE WHATSAPP CON IA ---
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    socketBot = makeWASocket({ auth: state, browser: ["ONE4CARS", "Chrome", "1.0.0"] });

    socketBot.ev.on('creds.update', saveCreds);

    socketBot.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;
        
        const from = msg.key.remoteJid;
        const body = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").toLowerCase();

        try {
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
            
            // MANUAL DE ENTRENAMIENTO [cite: 688, 707]
            const entrenamiento = `Eres ONE4-Bot de ONE4CARS. Importamos de China a Venezuela. 
            Venta EXCLUSIVA al mayor para tiendas. Moneda base: USD. Tasa: BCV. 
            Si piden saldo o descuento, SOLICITA EL RIF. 
            Si piden producto, busca en almacén intermedio.`;

            // Lógica de detección de intención [cite: 895]
            let respuestaExtra = "";
            
            if (body.includes("debo") || body.includes("saldo")) {
                // Si el mensaje ya trae un número, intentamos consultar
                const rifDetectado = body.match(/\d+/);
                if (rifDetectado) {
                    const saldo = await obtenerSaldoCliente(rifDetectado[0]);
                    respuestaExtra = `\n(Dato Real: Su saldo pendiente es $${saldo})`;
                }
            }

            const result = await model.generateContent(`${entrenamiento}\nUsuario: ${body}\nInfo Real Sistema: ${respuestaExtra}`);
            await socketBot.sendMessage(from, { text: result.response.text() });

        } catch (e) { console.error("Error:", e); }
    });
}

// Servidor para el QR [cite: 389, 390]
http.createServer(async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    if (qrCodeData === "ONLINE") res.end("<h1>BOT CONECTADO</h1>");
    else res.end(`<h1>Escanea el QR de ONE4CARS</h1><img src="${qrCodeData}">`);
}).listen(process.env.PORT || 10000);

startBot();
