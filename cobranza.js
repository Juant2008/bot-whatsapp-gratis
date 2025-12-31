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
        // Consulta simple: Solo lo que no está pagado y no está anulado
        const [rows] = await connection.execute(
            `SELECT celular, nombres, nro_factura, total, abono_factura, 
            (total - abono_factura) as saldo_pendiente, fecha_reg 
            FROM tab_facturas 
            WHERE pagada = 'NO' AND anulado <> 'si' AND id_cliente <> 334
            ORDER BY fecha_reg ASC`
        );
        return rows;
    } catch (error) {
        console.error("Error MySQL:", error.message);
        return [];
    } finally {
        if (connection) await connection.end();
    }
}

async function ejecutarEnvioMasivo(sock, deudores) {
    for (const row of deudores) {
        try {
            let num = row.celular.toString().replace(/\D/g, '');
            if (!num.startsWith('58')) num = '58' + num;
            const jid = `${num}@s.whatsapp.net`;
            
            const saldo = parseFloat(row.saldo_pendiente).toFixed(2);
            const texto = `Hola *${row.nombres}* 🚗, te saludamos de *ONE4CARS*.\n\nLe recordamos que su factura *${row.nro_factura}* presenta un *SALDO PENDIENTE de $${saldo}*.\n\nPor favor, gestione su pago a la brevedad.`;

            await sock.sendMessage(jid, { text: texto });
            console.log(`✅ Enviado a: ${row.nombres}`);
            
            await new Promise(r => setTimeout(r, 20000));
        } catch (e) {
            console.error(`Error enviando a ${row.nombres}`);
        }
    }
}

module.exports = { obtenerListaDeudores, ejecutarEnvioMasivo };
