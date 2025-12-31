const mysql = require('mysql2/promise');

const dbConfig = {
    host: 'one4cars.com',
    user: 'juant200_one4car',
    password: 'Notieneclave1*',
    database: 'juant200_venezon',
    connectTimeout: 30000 
};

// ... (Funciones obtenerVendedores y obtenerZonas se mantienen igual)
async function obtenerVendedores() {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const [rows] = await connection.execute('SELECT id_vendedor, nombre FROM tab_vendedores WHERE activo = "si" ORDER BY nombre ASC');
        return rows;
    } catch (e) { return []; } finally { if (connection) await connection.end(); }
}

async function obtenerZonas() {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const [rows] = await connection.execute('SELECT id_zona, zona FROM tab_zonas ORDER BY zona ASC');
        return rows;
    } catch (e) { return []; } finally { if (connection) await connection.end(); }
}

async function obtenerListaDeudores(filtros = {}) {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const minDias = filtros.dias || 30;
        const idVendedor = filtros.id_vendedor || '';
        const idZona = filtros.id_zona || '';

        let sql = `
            SELECT f.celular, f.nombres, f.nro_factura, f.total, f.abono_factura,
                   (f.total - f.abono_factura) AS saldo_pendiente,
                   f.fecha_reg, v.nombre as vendedor_nom, z.zona as zona_nom,
                   DATEDIFF(CURDATE(), f.fecha_reg) AS dias_transcurridos
            FROM tab_facturas f
            LEFT JOIN tab_vendedores v ON f.vendedor = v.nombre
            LEFT JOIN tab_zonas z ON f.zona = z.zona
            WHERE f.pagada = 'NO' AND f.id_cliente <> 334 AND f.anulado <> 'si'
            AND (f.total - f.abono_factura) > 0 AND DATEDIFF(CURDATE(), f.fecha_reg) >= ?
        `;
        const params = [minDias];
        if (idVendedor) { sql += ` AND v.id_vendedor = ?`; params.push(idVendedor); }
        if (idZona) { sql += ` AND z.id_zona = ?`; params.push(idZona); }
        sql += ` ORDER BY dias_transcurridos DESC`;
        const [rows] = await connection.execute(sql, params);
        return rows;
    } catch (error) { return []; } finally { if (connection) await connection.end(); }
}

// ESTA FUNCIÓN ES LA CLAVE: Ahora es más robusta
async function obtenerDetalleFacturas(facturasIds) {
    if (!facturasIds || facturasIds.length === 0) return [];
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const placeholders = facturasIds.map(() => '?').join(',');
        
        console.log(`[DB] Buscando datos para facturas: ${facturasIds.join(', ')}`);
        
        const [rows] = await connection.query(
            `SELECT celular, nombres, nro_factura, total, abono_factura, 
            (total - abono_factura) as saldo_pendiente, DATEDIFF(CURDATE(), fecha_reg) as dias_transcurridos 
            FROM tab_facturas WHERE nro_factura IN (${placeholders})`,
            facturasIds
        );
        
        console.log(`[DB] Se encontraron ${rows.length} registros válidos.`);
        return rows;
    } catch (e) { 
        console.error("[DB] ERROR:", e.message); 
        return []; 
    } finally { if (connection) await connection.end(); }
}

async function ejecutarEnvioMasivo(sock, deudores) {
    console.log(`[WHATSAPP] Iniciando tanda de ${deudores.length} mensajes.`);
    for (const row of deudores) {
        try {
            let num = row.celular.toString().replace(/\D/g, '');
            if (!num.startsWith('58')) num = '58' + num;
            const jid = `${num}@s.whatsapp.net`;
            const saldo = parseFloat(row.saldo_pendiente).toFixed(2);

            const texto = `Hola *${row.nombres}* 🚗, te saludamos de *ONE4CARS*.\n\nLe recordamos que su factura *${row.nro_factura}* presenta un *SALDO PENDIENTE de $${saldo}*.\n\nPor favor, gestione su pago a la brevedad.`;

            console.log(`[WHATSAPP] Enviando a ${row.nombres}...`);
            await sock.sendMessage(jid, { text: texto });
            console.log(`[WHATSAPP] ✅ ENTREGADO`);

            await new Promise(resolve => setTimeout(resolve, 15000));
        } catch (e) { 
            console.error(`[WHATSAPP] ❌ ERROR con ${row.nombres}:`, e.message); 
        }
    }
    console.log("[WHATSAPP] --- Proceso terminado ---");
}

module.exports = { obtenerListaDeudores, ejecutarEnvioMasivo, obtenerVendedores, obtenerZonas, obtenerDetalleFacturas };
