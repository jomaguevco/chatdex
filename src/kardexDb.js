const mysql = require('mysql2/promise');
const config = require('../config/config');
const logger = require('./utils/logger');

class KardexDatabase {
  constructor() {
    this.pool = null;
  }

  /**
   * Inicializar pool de conexiones MySQL
   */
  async initialize() {
    try {
      if (this.pool) {
        logger.warn('Pool de MySQL ya está inicializado');
        return;
      }

      const dbConfig = config.kardexDatabase;
      
      if (!dbConfig.host || !dbConfig.database) {
        logger.warn('⚠️ Configuración de base de datos Kardex no completa - usando solo API REST');
        return;
      }

      this.pool = mysql.createPool({
        host: dbConfig.host,
        port: dbConfig.port || 3306,
        database: dbConfig.database,
        user: dbConfig.user,
        password: dbConfig.password,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        enableKeepAlive: true,
        keepAliveInitialDelay: 0
      });

      // Probar conexión
      const connection = await this.pool.getConnection();
      await connection.ping();
      connection.release();
      
      logger.success('✅ Conexión a base de datos MySQL de Kardex establecida');
      return true;
    } catch (error) {
      logger.error('❌ Error al conectar con base de datos MySQL de Kardex', error);
      logger.warn('⚠️ Se usará solo API REST como fallback');
      this.pool = null;
      return false;
    }
  }

  /**
   * Obtener todos los productos activos
   */
  async getProductos(filters = {}) {
    if (!this.pool) {
      return null; // Indicar que debe usar API
    }

    try {
      let query = `
        SELECT 
          id,
          nombre,
          codigo_interno,
          descripcion,
          precio_venta,
          stock_actual,
          activo,
          categoria_id
        FROM productos
        WHERE activo = 1
      `;

      const params = [];

      if (filters.search) {
        query += ` AND (nombre LIKE ? OR codigo_interno LIKE ? OR descripcion LIKE ?)`;
        const searchTerm = `%${filters.search}%`;
        params.push(searchTerm, searchTerm, searchTerm);
      }

      if (filters.categoria_id) {
        query += ` AND categoria_id = ?`;
        params.push(filters.categoria_id);
      }

      query += ` ORDER BY nombre ASC`;

      if (filters.limit) {
        const limit = parseInt(filters.limit);
        query += ` LIMIT ${limit}`;
      }

      const [rows] = await this.pool.execute(query, params);
      return rows;
    } catch (error) {
      logger.error('Error al obtener productos desde BD', error);
      return null; // Fallback a API
    }
  }

  /**
   * Obtener un producto por ID
   */
  async getProducto(id) {
    if (!this.pool) {
      return null;
    }

    try {
      const [rows] = await this.pool.execute(
        `SELECT 
          id,
          nombre,
          codigo_interno,
          descripcion,
          precio_venta,
          stock_actual,
          activo,
          categoria_id
        FROM productos
        WHERE id = ? AND activo = 1`,
        [id]
      );

      return rows[0] || null;
    } catch (error) {
      logger.error(`Error al obtener producto ${id} desde BD`, error);
      return null;
    }
  }

  /**
   * Buscar productos por término de búsqueda
   */
  async buscarProductos(query, limit = 20) {
    if (!this.pool) {
      logger.debug('Pool de BD no disponible, usando API');
      return null;
    }

    try {
      const searchTerm = `%${query}%`;
      const limitNum = parseInt(limit) || 20;
      
      logger.debug('Ejecutando búsqueda en BD', { query, limit: limitNum });
      
      const [rows] = await this.pool.execute(
        `SELECT 
          id,
          nombre,
          codigo_interno,
          codigo_barras,
          descripcion,
          precio_venta,
          stock_actual,
          activo,
          categoria_id
        FROM productos
        WHERE activo = 1 
          AND (nombre LIKE ? OR codigo_interno LIKE ? OR codigo_barras LIKE ? OR descripcion LIKE ?)
        ORDER BY 
          CASE 
            WHEN nombre LIKE ? THEN 1
            WHEN codigo_interno LIKE ? THEN 2
            WHEN codigo_barras LIKE ? THEN 3
            ELSE 4
          END,
          nombre ASC
        LIMIT ${limitNum}`,
        [searchTerm, searchTerm, searchTerm, searchTerm, `%${query}%`, `%${query}%`, `%${query}%`]
      );

      logger.info(`✅ BD: ${rows.length} productos encontrados para "${query}"`);
      return rows;
    } catch (error) {
      logger.error('❌ Error al buscar productos desde BD', {
        query,
        error: error.message,
        stack: error.stack
      });
      return null;
    }
  }

  /**
   * Verificar stock de productos
   */
  async verificarStock(productoId, cantidad) {
    if (!this.pool) {
      return null;
    }

    try {
      const [rows] = await this.pool.execute(
        `SELECT stock_actual, nombre, precio_venta
        FROM productos
        WHERE id = ? AND activo = 1`,
        [productoId]
      );

      if (rows.length === 0) {
        return { disponible: false, error: 'Producto no encontrado' };
      }

      const producto = rows[0];
      const disponible = producto.stock_actual >= cantidad;

      return {
        disponible,
        stock_actual: producto.stock_actual,
        nombre: producto.nombre,
        precio_venta: producto.precio_venta,
        error: disponible ? null : `Stock insuficiente. Disponible: ${producto.stock_actual}`
      };
    } catch (error) {
      logger.error('Error al verificar stock desde BD', error);
      return null;
    }
  }

  /**
   * Cerrar pool de conexiones
   */
  async close() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      logger.info('Pool de conexiones MySQL cerrado');
    }
  }

  /**
   * Buscar cliente por número de teléfono
   * Normaliza el número de teléfono y busca coincidencias
   */
  async buscarClientePorTelefono(telefono) {
    if (!this.pool) {
      // Si no hay BD, intentar API
      try {
        const kardexApi = require('./kardexApi');
        const clientes = await kardexApi.getClientes({ search: telefono, limit: 10 });
        if (clientes && clientes.length > 0) {
          // Buscar por teléfono en los resultados
          const cliente = clientes.find(c => {
            const tel = (c.telefono || '').toString().replace(/[^0-9]/g, '');
            const telInput = telefono.toString().replace(/[^0-9]/g, '');
            return tel.includes(telInput) || telInput.includes(tel) || tel === telInput;
          });
          return cliente || null;
        }
        return null;
      } catch (error) {
        logger.warn('No se pudo buscar cliente por API', error.message);
        return null;
      }
    }

    try {
      // Normalizar número de teléfono (eliminar caracteres no numéricos excepto +)
      let telefonoNormalizado = telefono.toString().replace(/[^0-9+]/g, '');
      // Eliminar el + si existe
      telefonoNormalizado = telefonoNormalizado.replace(/^\+/, '');
      
      logger.info(`🔍 Buscando cliente por teléfono: ${telefono} -> normalizado: ${telefonoNormalizado}`);
      
      // Generar variantes del número para búsqueda flexible
      let telefonos = [telefonoNormalizado];
      
      // Si el número incluye código de país (51), también buscar sin él
      if (telefonoNormalizado.startsWith('51') && telefonoNormalizado.length >= 11) {
        const sinCodigo = telefonoNormalizado.substring(2);
        telefonos.push(sinCodigo);
        logger.debug(`   Variante sin código: ${sinCodigo}`);
      }
      
      // Si no tiene código de país y tiene 9 dígitos, agregar código
      if (!telefonoNormalizado.startsWith('51') && telefonoNormalizado.length === 9) {
        const conCodigo = '51' + telefonoNormalizado;
        telefonos.push(conCodigo);
        logger.debug(`   Variante con código: ${conCodigo}`);
      }
      
      // También buscar solo los últimos 9 dígitos (sin código de país)
      if (telefonoNormalizado.length >= 9) {
        const ultimos9 = telefonoNormalizado.slice(-9);
        if (!telefonos.includes(ultimos9)) {
          telefonos.push(ultimos9);
          logger.debug(`   Variante últimos 9: ${ultimos9}`);
        }
      }

      // Eliminar duplicados
      telefonos = [...new Set(telefonos)];
      
      logger.info(`🔍 Búsqueda con ${telefonos.length} variantes: ${telefonos.join(', ')}`);

      // Buscar en base de datos con múltiples variantes
      // Usar REPLACE para normalizar también los números en la BD
      const searchConditions = telefonos.map(() => 
        `(REPLACE(REPLACE(REPLACE(telefono, '+', ''), ' ', ''), '-', '') = ? OR 
          REPLACE(REPLACE(REPLACE(telefono, '+', ''), ' ', ''), '-', '') LIKE ? OR 
          telefono LIKE ? OR
          telefono LIKE ?)`
      ).join(' OR ');
      
      // Crear array de parámetros: para cada variante, múltiples búsquedas
      const params = [];
      telefonos.forEach(tel => {
        params.push(tel); // Coincidencia exacta normalizada
        params.push(`%${tel}%`); // LIKE en normalizado (contiene)
        params.push(`%${tel}%`); // LIKE en original (contiene)
        params.push(`%${tel}`); // LIKE en original (termina con)
      });
      
      const query = `
        SELECT 
          id,
          nombre,
          tipo_documento,
          numero_documento,
          telefono,
          email,
          direccion,
          tipo_cliente
        FROM clientes
        WHERE ${searchConditions}
        ORDER BY 
          CASE 
            WHEN REPLACE(REPLACE(REPLACE(telefono, '+', ''), ' ', ''), '-', '') = ? THEN 1
            WHEN REPLACE(REPLACE(REPLACE(telefono, '+', ''), ' ', ''), '-', '') LIKE ? THEN 2
            ELSE 3
          END,
          nombre ASC
        LIMIT 1
      `;
      
      // Agregar parámetros para el ORDER BY (usar la primera variante)
      params.push(telefonos[0], `%${telefonos[0]}%`);
      
      logger.debug(`🔍 Ejecutando query con ${params.length} parámetros`);
      logger.debug(`🔍 Variantes buscadas: ${telefonos.join(', ')}`);
      logger.debug(`🔍 Query: ${query.substring(0, 200)}...`);
      
      const [rows] = await this.pool.execute(query, params);

      if (rows && rows.length > 0) {
        logger.info(`✅ Cliente encontrado: ${rows[0].nombre} para teléfono ${telefono} (BD tenía: ${rows[0].telefono})`);
        return rows[0];
      }

      logger.warn(`⚠️ No se encontró cliente para teléfono ${telefono} (variantes probadas: ${telefonos.join(', ')})`);
      return null;
    } catch (error) {
      logger.error('Error al buscar cliente por teléfono', error);
      return null;
    }
  }

  /**
   * Verificar si la conexión está activa
   */
  isConnected() {
    return this.pool !== null;
  }
}

module.exports = new KardexDatabase();

