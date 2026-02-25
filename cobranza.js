const mysql = require('mysql2/promise');

const dbConfig = {
    host: 'one4cars.com',
    user: 'juant200_one4car',
    password: 'Notieneclave1*',
    database: 'juant200_venezon',
    connectTimeout: 30000 
};

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
        const [rows] = await conn.execute('SELECT DISTINCT zona FROM tab_clientes WHERE zona IS NOT NULL AND zona != "" ORDER BY zona ASC');
        return rows;
    } catch (e) { return []; } finally { if (conn) await conn.end(); }
}

async function obtenerListaDeudores(filtros = {}) {
    let conn;
    try {
        conn = await mysql.createConnection(dbConfig);
        const minDias = filtros.dias || 0;
        const vendedor = filtros.vendedor || '';
        const zona = filtros.zona || '';

        // SQL CORREGIDO: Usamos fecha_reg y valor_cambio
        let sql = `
            SELECT f.celular, f.nombres, f.nro_factura, f.total, f.abono_factura,
                   (f.total - f.abono_factura) AS saldo_pendiente, 
                   ((f.total - f.abono_factura) * (SELECT valor_cambio FROM tab_monedas WHERE id_moneda = 2 LIMIT 1)) AS saldo_bolivares,
                   DATEDIFF(CURDATE(), f.fecha_reg) as dias_transcurridos 
            FROM tab_facturas f
            WHERE f.pagada = 'NO' and f.anulado = 'NO'
            AND (f.total - f.abono_factura) > 1 
            AND DATEDIFF(CURDATE(), f.fecha_reg) >= ?`;
        
        let params = [minDias];
        
        if (vendedor) { 
            sql += ` AND f.id_vendedor = (SELECT id_vendedor FROM tab_vendedores WHERE nombre = ? LIMIT 1)`; 
            params.push(vendedor); 
        }
        if (zona) { 
            sql += ` AND f.id_cliente IN (SELECT id_cliente FROM tab_clientes WHERE zona = ?)`; 
            params.push(zona); 
        }
        
        sql += ` ORDER BY dias_transcurridos DESC`;

        const [rows] = await conn.execute(sql, params);
        return rows;
    } catch (e) { 
        console.error("Error SQL Detallado:", e.message);
        throw e; 
    } finally { if (conn) await conn.end(); }
}

async function ejecutarEnvioMasivo(sock, facturas) {
    for (const row of facturas) {
        try {
            let num = row.celular.toString().replace(/\D/g, '');
            if (!num.startsWith('58')) num = '58' + num;
            const jid = `${num}@s.whatsapp.net`;

            const texto = `Hola *${row.nombres}* 🚗, de *ONE4CARS*.\n\nLe Notificamos que su Nota está pendiente:\n\nFactura: *${row.nro_factura}*\nSaldo: *Bs. ${parseFloat(row.saldo_bolivares).toFixed(2)}* (Ref. $${parseFloat(row.saldo_pendiente).toFixed(2)})\nPresenta: *${row.dias_transcurridos} días vencidos*\n\nPor favor, gestione su pago a la brevedad. Cuide su crédito.`;
            
            if (sock) {
                await sock.sendMessage(jid, { text: texto });
            }
            await new Promise(r => setTimeout(r, 7000));
        } catch (e) { console.log("Error envío individual"); }
    }
}

module.exports = { obtenerVendedores, obtenerZonas, obtenerListaDeudores, ejecutarEnvioMasivo };
