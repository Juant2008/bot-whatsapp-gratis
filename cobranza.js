const mysql = require('mysql2/promise');

const dbConfig = {
    host: 'one4cars.com',
    user: 'juant200_one4car',
    password: 'Notieneclave1*',
    database: 'juant200_venezon',
    connectTimeout: 30000 
};

async function obtenerListaDeudores() {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const query = `
            SELECT celular, nombres, nro_factura, total, fecha_reg 
            FROM tab_facturas 
            WHERE pagada = 'NO' 
            AND id_cliente <> 334 
            AND anulado <> 'si'
            AND DATEDIFF(CURDATE(), fecha_reg) > 40
            ORDER BY fecha_reg ASC
        `;
        const [rows] = await connection.execute(query);
        return rows;
    } catch (error) {
        console.error("❌ ERROR MYSQL:", error.message);
        return [];
    } finally {
        if (connection) await connection.end();
    }
}

async function ejecutarEnvioMasivo(sock, deudoresSeleccionados) {
    console.log(`🚀 Enviando mensajes a ${deudoresSeleccionados.length} seleccionados...`);
    for (const row of deudoresSeleccionados) {
        try {
            const jid = `${row.celular}@s.whatsapp.net`;
            const texto = `Hola *${row.nombres}* 🚗, te saludamos de *ONE4CARS*.\n\nLe informamos que su factura *${row.nro_factura}* por un monto de *${row.total}* se encuentra pendiente desde el ${row.fecha_reg}.\n\nPor favor, gestione su pago a la brevedad. Si ya realizó el pago, por favor envíenos el comprobante.`;
            
            await sock.sendMessage(jid, { text: texto });
            console.log(`✅ Enviado a: ${row.nombres}`);
            
            // Pausa de seguridad
            await new Promise(resolve => setTimeout(resolve, 20000));
        } catch (e) {
            console.error(`❌ Error enviando a ${row.celular}:`, e.message);
        }
    }
}

module.exports = { obtenerListaDeudores, ejecutarEnvioMasivo };
