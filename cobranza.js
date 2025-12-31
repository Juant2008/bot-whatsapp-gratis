const mysql = require('mysql2/promise');

const dbConfig = {
    host: 'one4cars.com',
    user: 'juant200_one4car',
    password: 'Notieneclave1*',
    database: 'juant200_venezon',
    connectTimeout: 30000 
};

// ... (obtenerVendedores y obtenerZonas se mantienen igual)
async function obtenerVendedores() {
    let conn;
    try {
        conn = await mysql.createConnection(dbConfig);
        const [rows] = await conn.execute('SELECT DISTINCT nombre FROM tab_vendedores WHERE activo = "si" ORDER BY nombre ASC');
        return rows;
    } catch (e) { return []; } finally { if (conn) await conn.end(); }
}

async function obtenerZonas() {
    let conn;
    try {
        conn = await mysql.createConnection(dbConfig);
        const [rows] = await conn.execute('SELECT DISTINCT zona FROM tab_zonas ORDER BY zona ASC');
        return rows;
    } catch (e) { return []; } finally { if (conn) await conn.end(); }
}

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
            `SELECT celular, nombres, nro_factura, (total - abono_factura) as saldo_pendiente, DATEDIFF(CURDATE(), fecha_reg) as dias_mora 
             FROM tab_facturas WHERE nro_factura IN (${placeholders})`,
            ids
        );
        console.log(`[DB] Encontradas: ${rows.length} facturas para enviar.`);
        return rows;
    } catch (e) { console.error("[DB] Error:", e.message); return []; } 
    finally { if (connection) await connection.end(); }
}

async function ejecutarEnvioMasivo(sock, deudores) {
    console.log(`\n--- 🚀 INICIO DE ENVÍO A ${deudores.length} CLIENTES ---`);
    
    for (const row of deudores) {
        try {
            // 1. LIMPIEZA QUIRÚRGICA DEL NÚMERO
            let num = row.celular.toString().replace(/\D/g, ''); // Quita espacios, letras y símbolos
            
            // 2. CORRECCIÓN VENEZUELA (Quitar 0 después de 58)
            // Si el número es 580412... lo convertimos a 58412...
            if (num.startsWith('580')) {
                num = '58' + num.substring(3);
            }
            
            const jid = `${num}@s.whatsapp.net`;
            const saldo = parseFloat(row.saldo_pendiente).toFixed(2);
            
            const texto = `Hola *${row.nombres}* 🚗, te saludamos de *ONE4CARS*.\n\nLe recordamos que su factura *${row.nro_factura}* presenta un *SALDO PENDIENTE de $${saldo}*.\n\nEsta factura tiene ${row.dias_mora} días de vencimiento. Por favor, gestione su pago a la brevedad.`;

            console.log(`📤 Intentando enviar a: ${row.nombres} (${jid})`);
            
            await sock.sendMessage(jid, { text: texto });
            
            console.log(`✅ MENSAJE ENTREGADO`);
            
            // Pausa de seguridad para evitar baneo (20 seg)
            await new Promise(r => setTimeout(r, 20000));
        } catch (e) { 
            console.error(`❌ ERROR REAL con ${row.nombres}:`, e.message); 
        }
    }
    console.log("--- 🏁 FIN DEL PROCESO DE COBRANZA ---\n");
}

module.exports = { obtenerListaDeudores, ejecutarEnvioMasivo, obtenerDetalleFacturas, obtenerVendedores, obtenerZonas };
