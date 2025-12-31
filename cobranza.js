const mysql = require('mysql2/promise');

const dbConfig = {
    host: 'one4cars.com',
    user: 'juant200_one4car',
    password: 'Notieneclave1*',
    database: 'juant200_venezon',
    connectTimeout: 30000 
};

// Traer lista completa de deudores
async function obtenerListaDeudores() {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const [rows] = await connection.execute(
            `SELECT celular, nombres, nro_factura, total, abono_factura, 
            (total - abono_factura) AS saldo_pendiente, fecha_reg,
            DATEDIFF(CURDATE(), fecha_reg) AS dias_mora
            FROM tab_facturas 
            WHERE pagada = 'NO' AND anulado <> 'si' AND id_cliente <> 334
            AND (total - abono_factura) > 0 
            ORDER BY fecha_reg ASC`
        );
        return rows;
    } catch (error) {
        console.error("❌ Error DB:", error.message);
        return [];
    } finally {
        if (connection) await connection.end();
    }
}

// Función para enviar mensajes uno a uno
async function ejecutarEnvioMasivo(sock, deudores) {
    console.log(`🚀 Iniciando tanda de mensajes para ${deudores.length} clientes...`);
    for (const row of deudores) {
        try {
            let num = row.celular.toString().replace(/\D/g, '');
            if (!num.startsWith('58')) num = '58' + num;
            const jid = `${num}@s.whatsapp.net`;
            const saldo = parseFloat(row.saldo_pendiente).toFixed(2);
            
            const texto = `Hola *${row.nombres}* 🚗, te saludamos de *ONE4CARS*.\n\nLe informamos que su factura *${row.nro_factura}* presenta un *SALDO PENDIENTE de $${saldo}*.\n\nPor favor, gestione su pago a la brevedad para mantener su cuenta al día.`;

            await sock.sendMessage(jid, { text: texto });
            console.log(`✅ Enviado a: ${row.nombres}`);
            await new Promise(r => setTimeout(r, 20000)); // Espera de 20 seg por seguridad
        } catch (e) {
            console.error(`❌ Error enviando a ${row.nombres}`);
        }
    }
}

module.exports = { obtenerListaDeudores, ejecutarEnvioMasivo };
