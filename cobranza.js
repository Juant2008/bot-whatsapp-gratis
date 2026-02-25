const mysql = require('mysql2/promise');

// Configuración de la Base de Datos
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
    } catch (e) { 
        console.error("Error obteniendo vendedores:", e.message);
        return []; 
    } finally { if (conn) await conn.end(); }
}

async function obtenerZonas() {
    let conn;
    try {
        conn = await mysql.createConnection(dbConfig);
        const [rows] = await conn.execute('SELECT DISTINCT zona FROM tab_zonas ORDER BY zona ASC');
        return rows;
    } catch (e) { 
        console.error("Error obteniendo zonas:", e.message);
        return []; 
    } finally { if (conn) await conn.end(); }
}

async function obtenerListaDeudores(filtros = {}) {
    let conn;
    try {
        conn = await mysql.createConnection(dbConfig);
        const minDias = filtros.dias || 0;
        const vendedor = filtros.vendedor || '';
        const zona = filtros.zona || '';

        let sql = `
            SELECT celular, nombres, nro_factura, total, abono_factura,
                   (total - abono_factura) AS saldo_pendiente, 
                   ((total - abono_factura) / NULLIF(porcentaje, 0)) AS saldo_bolivares,
                   fecha_reg, vendedor as vendedor_nom, zona as zona_nom,
                   DATEDIFF(CURDATE(), fecha_reg) AS dias_transcurridos
            FROM tab_facturas 
            WHERE pagada = 'NO' 
            AND (anulado IS NULL OR anulado <> 'si')
            AND (total - abono_factura) > 0 
            AND DATEDIFF(CURDATE(), fecha_reg) >= ?
        `;
        const params = [minDias];
        
        if (vendedor) { sql += ` AND vendedor = ?`; params.push(vendedor); }
        if (zona) { sql += ` AND zona = ?`; params.push(zona); }
        
        sql += ` ORDER BY dias_transcurridos DESC`;

        const [rows] = await conn.execute(sql, params);
        return rows;
    } catch (e) { 
        console.error("Error SQL:", e.message);
        return []; 
    } finally { if (conn) await conn.end(); }
}

async function ejecutarEnvioMasivo(sock, facturas) {
    // Lista de clientes que NO deben ver precios en bolívares (usar nombres exactos de la BD)
    const excluirBolivares = ['CLIENTE_1', 'CLIENTE_2']; 

    for (const row of facturas) {
        if (!row.celular) continue; // Si no hay celular, saltar

        try {
            // 1. Limpieza segura de número
            let num = String(row.celular).replace(/\s/g, '').replace(/\D/g, '');
            
            // 2. Corregir formato venezonalo (0412 -> 58412)
            if (num.startsWith('0')) {
                num = '58' + num.substring(1);
            }
            // Si el número es muy corto o no empieza con 58, intentamos arreglarlo
            if (!num.startsWith('58') && num.length > 9) {
                num = '58' + num;
            }

            const jid = `${num}@s.whatsapp.net`;

            // Lógica de privacidad para el saldo
            let saldoTexto = "";
            const saldoDolares = parseFloat(row.saldo_pendiente || 0).toFixed(2);
            const saldoBs = parseFloat(row.saldo_bolivares || 0).toFixed(2);

            // Verificar si el nombre está en la lista de exclusión
            if (excluirBolivares.some(n => row.nombres && row.nombres.includes(n))) {
                saldoTexto = `Saldo: *Ref. ${saldoDolares}*`;
            } else {
                saldoTexto = `Saldo: *Ref. ${saldoDolares} / Bs. ${saldoBs}*`;
            }

            const texto = `Hola *${row.nombres || 'Cliente'}* 🚗, de *ONE4CARS*.\n\nLe Notificamos que su Nota está pendiente:\n\nFactura: *${row.nro_factura}*\n${saldoTexto}\nPresenta: *${row.dias_transcurridos} días vencidos*\n\nPor favor, gestione su pago a la brevedad. Cuide su crédito, es valioso.`;
            
            // Verificación del socket
            if (sock && typeof sock.sendMessage === 'function') {
                await sock.sendMessage(jid, { text: texto });
                console.log(`✅ Enviado a: ${row.nombres} (${num})`);
                
                // Espera de 10 segundos entre mensajes (Antiban)
                await new Promise(r => setTimeout(r, 10000));
            } else {
                console.log("❌ El bot no está conectado, no se pudo enviar.");
                break; // Si el bot se desconectó, paramos el bucle
            }

        } catch (e) {
            console.log("Error enviando mensaje a una fila:", e.message);
        }
    }
}

module.exports = { obtenerListaDeudores, ejecutarEnvioMasivo, obtenerVendedores, obtenerZonas };
