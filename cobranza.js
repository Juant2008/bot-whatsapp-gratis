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
        const [rows] = await connection.execute(
            `SELECT celular, nombres, nro_factura, total, abono_factura, 
            (total - abono_factura) AS saldo_pendiente, fecha_reg,
            DATEDIFF(CURDATE(), fecha_reg) AS dias_mora
            FROM tab_facturas 
            WHERE pagada = 'NO' AND anulado <> 'si' AND id_cliente <> 334
            AND (total - abono_factura) > 0 
            AND DATEDIFF(CURDATE(), fecha_reg) > 300
            ORDER BY fecha_reg ASC`
        );
        return rows;
    } catch (error) { return []; } finally { if (connection) await connection.end(); }
}

async function obtenerDetalleFacturas(listaFacturas) {
    if (!listaFacturas || listaFacturas.length === 0) return [];
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const ids = Array.isArray(listaFacturas) ? listaFacturas : [listaFacturas];
        const placeholders = ids.map(() => '?').join(',');
        const [rows] = await connection.query(
            `SELECT celular, nombres, nro_factura, total, abono_factura, 
             (total - abono_factura) as saldo_pendiente, DATEDIFF(CURDATE(), fecha_reg) as dias_mora 
             FROM tab_facturas WHERE nro_factura IN (${placeholders})`,
            ids
        );
        return rows;
    } catch (e) { return []; } finally { if (connection) await connection.end(); }
}

async function ejecutarEnvioMasivo(sock, deudores) {
    console.log(`\n--- 🚀 PROCESO DE COBRANZA: ${deudores.length} CLIENTES ---`);
    
    for (const row of deudores) {
        try {
            // 1. LIMPIEZA PROFUNDA DEL NÚMERO
            let num = row.celular.toString().replace(/\D/g, ''); // Quita todo lo que no sea número
            
            if (num.startsWith('0')) num = num.substring(1); // Quita el 0 inicial si existe
            if (!num.startsWith('58')) num = '58' + num; // Agrega 58 si no lo tiene
            
            const jid = `${num}@s.whatsapp.net`;
            const saldo = parseFloat(row.saldo_pendiente).toFixed(2);
            
            const texto = `Hola *${row.nombres}* 🚗, te saludamos de *ONE4CARS*.\n\nLe informamos que su factura *${row.nro_factura}* presenta un *SALDO PENDIENTE de $${saldo}*.\n\nEsta factura tiene ${row.dias_mora} días de vencimiento. Por favor, gestione su pago a la brevedad.`;

            // Log para debug en Render
            console.log(`📤 Enviando a: ${row.nombres} | Número Final: ${jid}`);
            
            await sock.sendMessage(jid, { text: texto });
            
            console.log(`✅ ¡Entregado con éxito!`);
            
            // Pausa de 20 segundos para evitar bloqueos
            await new Promise(r => setTimeout(r, 20000));
        } catch (e) { 
            console.error(`❌ ERROR REAL al enviar a ${row.nombres}:`, e.message); 
        }
    }
    console.log("--- 🏁 FIN DEL PROCESO ---\n");
}

module.exports = { obtenerListaDeudores, ejecutarEnvioMasivo, obtenerDetalleFacturas };
