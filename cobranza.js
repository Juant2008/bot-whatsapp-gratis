const mysql = require('mysql2/promise');

const dbConfig = {
    host: 'one4cars.com',
    user: 'juant200_one4car',
    password: 'Notieneclave1*',
    database: 'juant200_venezon',
    connectTimeout: 30000 
};

// ... obtenerVendedores y obtenerZonas se mantienen igual ...
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
        return rows;
    } catch (e) { console.error("[DB ERROR]", e.message); return []; } 
    finally { if (connection) await connection.end(); }
}

async function ejecutarEnvioMasivo(sock, deudores) {
    console.log(`\n--- 🚀 PROCESANDO ENVÍO PARA ${deudores.length} CLIENTES ---`);
    
    for (const row of deudores) {
        try {
            // 1. LIMPIEZA DE ESPACIOS Y CARACTERES
            let numRaw = row.celular.toString().replace(/\s+/g, '').replace(/\D/g, ''); 
            
            // 2. CORRECCIÓN DEL 580 (Error común en tu base de datos)
            // Si el número es 580412... lo convertimos a 58412...
            let numFinal = numRaw;
            if (numRaw.startsWith('580')) {
                numFinal = '58' + numRaw.substring(3);
            } else if (!numRaw.startsWith('58')) {
                numFinal = '58' + numRaw;
            }
            
            const jid = `${numFinal}@s.whatsapp.net`;
            const saldo = parseFloat(row.saldo_pendiente).toFixed(2);
            
            const texto = `Hola *${row.nombres}* 🚗, te saludamos de *ONE4CARS*.\n\nLe recordamos que su factura *${row.nro_factura}* presenta un *SALDO PENDIENTE de $${saldo}*.\n\nPor favor, gestione su pago a la brevedad.`;

            // LOG DE CONTROL PARA RENDER
            console.log(`📤 Cliente: ${row.nombres} | Original: ${row.celular} | Procesado: ${numFinal}`);
            
            await sock.sendMessage(jid, { text: texto });
            
            console.log(`✅ MENSAJE ENTREGADO A WHATSAPP`);
            
            // Pausa de 15 segundos entre mensajes
            await new Promise(r => setTimeout(r, 15000));
        } catch (e) { 
            console.error(`❌ ERROR ENVIANDO A ${row.nombres}:`, e.message); 
        }
    }
}

module.exports = { obtenerListaDeudores, ejecutarEnvioMasivo, obtenerDetalleFacturas, obtenerVendedores, obtenerZonas };
