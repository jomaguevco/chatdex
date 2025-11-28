const axios = require('axios');
const config = require('../config/config');
const logger = require('./utils/logger');

class KardexAPI {
  constructor() {
    this.baseUrl = config.kardexApi.baseUrl;
    this.authToken = config.kardexApi.authToken;
    this.timeout = config.kardexApi.timeout;
    
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: this.timeout,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': this.authToken ? `Bearer ${this.authToken}` : undefined
      }
    });
    
    
    // Interceptor para agregar token solo si está disponible
    this.client.interceptors.request.use(
      (config) => {
        if (this.authToken && !config.headers.Authorization) {
          config.headers.Authorization = `Bearer ${this.authToken}`;
        }
        return config;
      },
      (error) => {
        return Promise.reject(error);
      }
    );
  }

  /**
   * Obtener cliente por teléfono
   */
  async getClientById(clientId) {
    try {
      logger.info(`🔍 API: Buscando cliente por ID: ${clientId}`);
      
      // Usar token del chatbot si está disponible
      const token = config.kardexApi.chatbotToken || process.env.CHATBOT_API_TOKEN || '';
      const headers = token ? { 'x-chatbot-token': token } : {};
      
      const res = await this.client.get(`/clientes/${clientId}`, { headers }).catch((error) => {
        logger.warn(`⚠️ Error al buscar cliente por ID: ${error.response?.status} - ${error.response?.data?.message || error.message}`);
        return null;
      });
      
      if (res && res.data && res.data.success && res.data.data) {
        logger.info(`✅ API: Cliente encontrado por ID: ${res.data.data.nombre}`);
        return res.data.data;
      }
      
      // Si falla con autenticación, intentar buscar directamente desde la BD
      logger.info(`⚠️ API: No se encontró cliente con ID ${clientId} por API, intentando BD directa...`);
      try {
        const kardexDb = require('./kardexDb');
        if (kardexDb.isConnected()) {
          const pool = kardexDb.getPool();
          if (pool) {
            const [rows] = await pool.execute(
              'SELECT id, nombre, email, telefono, numero_documento, tipo_documento, direccion, activo FROM clientes WHERE id = ?',
              [clientId]
            );
            if (rows && rows.length > 0) {
              logger.info(`✅ Cliente encontrado por ID desde BD directa: ${rows[0].nombre}`);
              return rows[0];
            }
          }
        }
      } catch (dbError) {
        logger.warn(`⚠️ Error al buscar cliente en BD directa: ${dbError.message}`);
      }
      
      logger.warn(`⚠️ API: No se encontró cliente con ID: ${clientId}`);
      return null;
    } catch (error) {
      logger.error('Error al obtener cliente por ID', error);
      return null;
    }
  }

  async getClientByPhone(phone) {
    try {
      // Normalizar número (eliminar caracteres no numéricos)
      const numero = (phone || '').toString().replace(/[^0-9]/g, '');
      
      // Si el número tiene 9 dígitos, agregar código de país 51
      let numeroBuscado = numero;
      if (numero.length === 9 && !numero.startsWith('51')) {
        numeroBuscado = '51' + numero;
      }
      
      logger.info(`🔍 API: Buscando cliente por teléfono: ${phone} -> ${numeroBuscado}`);
      
      // Intentar primero con el número normalizado completo
      let res = await this.client.get(`/clientes/by-phone/${numeroBuscado}`).catch(() => null);
      
      if (res && res.data && res.data.success && res.data.data) {
        logger.info(`✅ API: Cliente encontrado: ${res.data.data.nombre}`);
        return res.data.data;
      }
      
      // Si no se encontró y tiene código de país, intentar sin él
      if (numeroBuscado.startsWith('51') && numeroBuscado.length > 10) {
        const sinCodigo = numeroBuscado.substring(2);
        logger.info(`🔍 API: Buscando sin código de país: ${sinCodigo}`);
        res = await this.client.get(`/clientes/by-phone/${sinCodigo}`).catch(() => null);
        
        if (res && res.data && res.data.success && res.data.data) {
          logger.info(`✅ API: Cliente encontrado (sin código): ${res.data.data.nombre}`);
          return res.data.data;
        }
      }
      
      // Si no se encontró, intentar con el número original
      if (numero !== numeroBuscado) {
        logger.info(`🔍 API: Buscando con número original: ${numero}`);
        res = await this.client.get(`/clientes/by-phone/${numero}`).catch(() => null);
        
        if (res && res.data && res.data.success && res.data.data) {
          logger.info(`✅ API: Cliente encontrado (original): ${res.data.data.nombre}`);
          return res.data.data;
        }
      }
      
      logger.warn(`⚠️ API: No se encontró cliente para ${phone}`);
      return null;
    } catch (error) {
      logger.error('Error al obtener cliente por teléfono', error);
      return null;
    }
  }

  /**
   * Vincular teléfono a cliente
   */
  async linkPhoneToClient(clientId, phone) {
    try {
      const res = await this.client.post('/clientes/link-phone', { clientId, phone });
      return !!(res.data && res.data.success);
    } catch (error) {
      logger.error('Error al vincular teléfono a cliente', error);
      return false;
    }
  }

  /**
   * Verificar contraseña del cliente por teléfono
   */
  async verifyClientPassword(telefono, contrasena, clientId = null) {
    try {
      console.log('══════════════════════════════════════════════════════════════════════');
      console.log('🔐 INICIANDO VERIFICACIÓN DE CONTRASEÑA');
      console.log(`📞 Teléfono recibido: ${telefono}`);
      console.log(`🔑 Contraseña recibida: "${contrasena}"`);
      console.log(`🆔 Client ID recibido: ${clientId || 'NO PROPORCIONADO'}`);
      console.log('══════════════════════════════════════════════════════════════════════');
      
      logger.info(`🔐 Verificando contraseña para teléfono: ${telefono}, contraseña recibida: "${contrasena}", clientId: ${clientId || 'NO PROPORCIONADO'}`);
      
      let cliente = null;
      
      // PRIORIDAD 1: Si tenemos clientId, usarlo directamente
      if (clientId) {
        console.log(`🔍 [PRIORIDAD] Buscando cliente por ID: ${clientId}`);
        logger.info(`🔐 [PRIORIDAD] Buscando cliente por ID: ${clientId}`);
        try {
          cliente = await this.getClientById(clientId);
          if (cliente) {
            console.log(`✅ Cliente encontrado por ID: ${cliente.nombre}`);
            logger.info(`✅ Cliente encontrado por ID: ${cliente.nombre}`);
          } else {
            console.log(`⚠️ Cliente con ID ${clientId} no encontrado, intentando por teléfono...`);
            logger.warn(`⚠️ Cliente con ID ${clientId} no encontrado, intentando por teléfono...`);
          }
        } catch (error) {
          console.log(`⚠️ Error al buscar cliente por ID: ${error.message}`);
          logger.warn(`⚠️ Error al buscar cliente por ID: ${error.message}`);
        }
      }
      
      // PRIORIDAD 2: Si no encontramos por ID, buscar por teléfono
      if (!cliente) {
        // Normalizar número
        const numero = (telefono || '').toString().replace(/[^0-9]/g, '');
        console.log(`📞 Número normalizado: ${numero}`);
        
        // Buscar cliente por teléfono
        console.log(`🔍 Buscando cliente con número: ${numero}`);
        cliente = await this.getClientByPhone(numero);
        if (!cliente) {
          console.log(`❌ Cliente NO encontrado para ${telefono}`);
          logger.warn(`⚠️ Cliente no encontrado para ${telefono}`);
          return { success: false, message: 'Cliente no encontrado' };
        }
      }
      
      console.log(`\n✅ ✅ ✅ Cliente encontrado:`);
      console.log(`   - Nombre: ${cliente.nombre}`);
      console.log(`   - Email: ${cliente.email || 'NO TIENE'}`);
      console.log(`   - DNI: ${cliente.numero_documento || 'NO TIENE'}`);
      console.log(`   - DNI (tipo): ${typeof cliente.numero_documento}`);
      console.log(`   - DNI (limpio): ${String(cliente.numero_documento || '').trim()}`);
      console.log(`   - ID: ${cliente.id}`);
      console.log(`   - Teléfono: ${cliente.telefono || 'NO TIENE'}`);
      
      logger.info(`🔐 Cliente encontrado: ${cliente.nombre}, email: ${cliente.email}, DNI: ${cliente.numero_documento}`);
      logger.info(`🔐 [DEBUG] Cliente completo: ${JSON.stringify({ id: cliente.id, nombre: cliente.nombre, email: cliente.email, dni: cliente.numero_documento, telefono: cliente.telefono })}`);
      
      // Intentar diferentes variantes del nombre_usuario
      // PRIORIDAD: cliente_${dni} es el formato estándar usado en el registro
      const posiblesUsuarios = [];
      
      // 1. cliente_${dni} - FORMATO ESTÁNDAR (PRIORIDAD MÁXIMA)
      if (cliente.numero_documento) {
        // Limpiar DNI: eliminar espacios, guiones, puntos, etc.
        const dniLimpio = String(cliente.numero_documento).trim().replace(/[\s\-\.]/g, '');
        const nombreUsuarioEstandar = `cliente_${dniLimpio}`;
        posiblesUsuarios.push(nombreUsuarioEstandar);
        console.log(`\n🔐 [PRIORIDAD] Agregando formato estándar: "${nombreUsuarioEstandar}"`);
        console.log(`   DNI original: "${cliente.numero_documento}"`);
        console.log(`   DNI limpio: "${dniLimpio}"`);
        logger.info(`🔐 [PRIORIDAD] Agregando formato estándar: "${nombreUsuarioEstandar}" (DNI original: "${cliente.numero_documento}")`);
      } else {
        console.log(`\n⚠️ ⚠️ ⚠️ CLIENTE NO TIENE DNI - NO PODREMOS HACER LOGIN`);
        logger.warn(`⚠️ Cliente ${cliente.nombre} no tiene número_documento`);
      }
      
      // 2. Email si existe
      if (cliente.email) {
        posiblesUsuarios.push(cliente.email);
      }
      
      // 3. Solo el DNI (limpio)
      if (cliente.numero_documento) {
        const dniLimpio = String(cliente.numero_documento).trim().replace(/[\s\-\.]/g, '');
        posiblesUsuarios.push(dniLimpio);
      }
      
      // 4. Nombre del cliente (si se usa como usuario)
      if (cliente.nombre) {
        const nombreLimpio = cliente.nombre.toLowerCase().replace(/\s+/g, '_');
        posiblesUsuarios.push(nombreLimpio);
      }
      
      console.log(`🔐 Intentando login con posibles usuarios: ${posiblesUsuarios.join(', ')}`);
      logger.info(`🔐 Intentando login con posibles usuarios: ${posiblesUsuarios.join(', ')}`);
      
      // Intentar login con cada variante
      for (const nombreUsuario of posiblesUsuarios) {
        try {
          console.log(`\n🔄 Intentando login con nombre_usuario: "${nombreUsuario}"`);
          console.log(`   Contraseña: "${contrasena}"`);
          logger.info(`🔐 Intentando login con nombre_usuario: "${nombreUsuario}"`);
          
          const res = await this.client.post('/auth/login', {
            nombre_usuario: nombreUsuario,
            contrasena: contrasena // El backend hasheará la contraseña
          });
          
          console.log(`   ✅ Respuesta del backend recibida`);
          console.log(`   ✅ Success: ${res.data?.success}`);
          console.log(`   ✅ Has data: ${!!res.data?.data}`);
          console.log(`   ✅ Has user: ${!!res.data?.data?.user}`);
          console.log(`   ✅ Has token: ${!!res.data?.data?.token}`);
          logger.info(`🔐 Respuesta del backend: success=${res.data?.success}, hasUser=${!!res.data?.data?.user}, hasToken=${!!res.data?.data?.token}`);
          
          if (res.data && res.data.success && res.data.data) {
            console.log(`\n✅ ✅ ✅ LOGIN EXITOSO con usuario: "${nombreUsuario}"`);
            console.log(`✅ Usuario autenticado: ${res.data.data.user?.nombre_completo || res.data.data.user?.nombre_usuario}`);
            logger.success(`✅ Contraseña verificada correctamente con usuario: "${nombreUsuario}"`);
            return {
              success: true,
              user: res.data.data.user,
              token: res.data.data.token,
              cliente: cliente
            };
          } else {
            console.log(`   ⚠️ Respuesta no exitosa del backend`);
            console.log(`   ⚠️ Data completa:`, JSON.stringify(res.data, null, 2));
            logger.warn(`⚠️ Respuesta no exitosa del backend: ${JSON.stringify(res.data)}`);
          }
        } catch (loginError) {
          const errorMsg = loginError.response?.data?.message || loginError.message;
          const statusCode = loginError.response?.status;
          const errorData = loginError.response?.data;
          
          console.log(`\n   ❌ ❌ ❌ Login falló con "${nombreUsuario}":`);
          console.log(`      Status Code: ${statusCode}`);
          console.log(`      Error Message: ${errorMsg}`);
          console.log(`      Error Data completo:`, JSON.stringify(errorData, null, 2));
          console.log(`      Request URL: ${loginError.config?.url}`);
          console.log(`      Request Data:`, JSON.stringify(loginError.config?.data, null, 2));
          
          logger.error(`❌ Login falló con "${nombreUsuario}": Status=${statusCode}, Error=${errorMsg}`);
          logger.error(`❌ Error completo:`, JSON.stringify(errorData, null, 2));
          
          // Continuar con el siguiente usuario
          continue;
        }
      }
      
      // Si ninguno funcionó, buscar otros clientes con el mismo número de teléfono
      console.log(`\n❌ ❌ ❌ NO SE PUDO VERIFICAR LA CONTRASEÑA CON NINGUNA VARIANTE`);
      console.log(`   Se intentaron ${posiblesUsuarios.length} variantes: ${posiblesUsuarios.join(', ')}`);
      logger.warn(`⚠️ No se pudo verificar la contraseña con ninguna variante de usuario`);
      
      // Buscar otros clientes con el mismo número de teléfono
      console.log(`\n🔍 Buscando otros clientes con el mismo número de teléfono: ${telefono}`);
      logger.info(`🔍 Buscando otros clientes con el mismo número de teléfono: ${telefono}`);
      
      try {
        const kardexDb = require('./kardexDb');
        const todosLosClientes = await kardexDb.buscarTodosLosClientesPorTelefono(telefono);
        
        if (todosLosClientes && todosLosClientes.length > 1) {
          console.log(`✅ Encontrados ${todosLosClientes.length} clientes con el mismo número`);
          logger.info(`✅ Encontrados ${todosLosClientes.length} clientes con el mismo número`);
          
          // Probar con cada cliente (excluyendo el que ya probamos)
          for (const otroCliente of todosLosClientes) {
            if (otroCliente.id === cliente.id) {
              continue; // Saltar el cliente que ya probamos
            }
            
            console.log(`\n🔄 Probando con otro cliente: ${otroCliente.nombre} (ID: ${otroCliente.id})`);
            logger.info(`🔄 Probando con otro cliente: ${otroCliente.nombre} (ID: ${otroCliente.id})`);
            
            // Intentar diferentes variantes del nombre_usuario para este cliente
            const otrosPosiblesUsuarios = [];
            
            // 1. cliente_${dni} - FORMATO ESTÁNDAR
            if (otroCliente.numero_documento) {
              const dniLimpio = String(otroCliente.numero_documento).trim().replace(/[\s\-\.]/g, '');
              otrosPosiblesUsuarios.push(`cliente_${dniLimpio}`);
            }
            
            // 2. Email si existe
            if (otroCliente.email) {
              otrosPosiblesUsuarios.push(otroCliente.email);
            }
            
            // 3. Solo el DNI
            if (otroCliente.numero_documento) {
              const dniLimpio = String(otroCliente.numero_documento).trim().replace(/[\s\-\.]/g, '');
              otrosPosiblesUsuarios.push(dniLimpio);
            }
            
            // 4. Nombre del cliente
            if (otroCliente.nombre) {
              const nombreLimpio = otroCliente.nombre.toLowerCase().replace(/\s+/g, '_');
              otrosPosiblesUsuarios.push(nombreLimpio);
            }
            
            // Intentar login con cada variante
            for (const nombreUsuario of otrosPosiblesUsuarios) {
              try {
                console.log(`   🔄 Intentando login con: "${nombreUsuario}"`);
                logger.info(`🔐 Intentando login con nombre_usuario: "${nombreUsuario}"`);
                
                const res = await this.client.post('/auth/login', {
                  nombre_usuario: nombreUsuario,
                  contrasena: contrasena
                });
                
                if (res.data && res.data.success && res.data.data) {
                  console.log(`\n✅ ✅ ✅ LOGIN EXITOSO con otro cliente: ${otroCliente.nombre}`);
                  console.log(`✅ Usuario autenticado: ${res.data.data.user?.nombre_completo || res.data.data.user?.nombre_usuario}`);
                  logger.success(`✅ Contraseña verificada correctamente con otro cliente: ${otroCliente.nombre} (usuario: "${nombreUsuario}")`);
                  return {
                    success: true,
                    user: res.data.data.user,
                    token: res.data.data.token,
                    cliente: otroCliente
                  };
                }
              } catch (loginError) {
                // Continuar con el siguiente usuario
                continue;
              }
            }
          }
        }
      } catch (searchError) {
        logger.error('Error al buscar otros clientes con el mismo número', searchError);
      }
      
      // Si ninguno funcionó, retornar error
      return {
        success: false,
        message: 'Contraseña incorrecta'
      };
    } catch (error) {
      logger.error('Error al verificar contraseña del cliente', error);
      return {
        success: false,
        message: error.response?.data?.message || error.message || 'Error al verificar contraseña'
      };
    }
  }

  /**
   * Registrar cliente completo desde el bot
   */
  async registerClientFull({ nombre, email, telefono, tipo_documento, numero_documento, direccion, contrasena }) {
    try {
      logger.info(`📝 Registrando cliente completo: ${nombre}, ${email}`);
      
      const res = await this.client.post('/auth/register-cliente', {
        nombre,
        email,
        telefono,
        tipo_documento: tipo_documento || 'DNI',
        numero_documento,
        direccion,
        contrasena
      });
      
      if (res.data && res.data.success) {
        logger.success(`✅ Cliente registrado exitosamente: ${nombre}`);
        return {
          success: true,
          cliente: res.data.data.cliente,
          user: res.data.data.user,
          token: res.data.data.token
        };
      }
      
      logger.warn('Registro cliente completo falló', { response: res.data });
      return {
        success: false,
        message: res.data?.message || 'Error al registrar cliente'
      };
    } catch (error) {
      const errorMessage = error.response?.data?.message || error.message || 'Error desconocido';
      logger.error('Error al registrar cliente completo', {
        error: errorMessage,
        status: error.response?.status,
        nombre,
        email: email?.replace(/(.{2})(.*)(@.*)/, '$1***$3') // Ocultar parte del email
      });
      return {
        success: false,
        message: errorMessage
      };
    }
  }

  /**
   * Registro ligero de cliente (nombre, dni, phone)
   */
  async registerClientLite({ name, dni, phone }) {
    try {
      const token = config.kardexApi.chatbotToken || process.env.CHATBOT_API_TOKEN || '';
      const res = await this.client.post('/clientes/register-lite', { name, dni, phone }, {
        headers: {
          'x-chatbot-token': token
        }
      });
      if (res.data && res.data.success) {
        return res.data.data;
      }
      logger.warn('Registro cliente lite falló', { response: res.data });
      return null;
    } catch (error) {
      const errorMessage = error.response?.data?.message || error.message || 'Error desconocido';
      const errorStatus = error.response?.status;
      logger.error('Error al registrar cliente lite', {
        error: errorMessage,
        status: errorStatus,
        name,
        dni,
        phone: phone?.replace(/\d(?=\d{4})/g, '*') // Ocultar parte del teléfono en logs
      });
      return null;
    }
  }

  /**
   * Obtener todos los productos
   */
  async getProductos(filters = {}) {
    try {
      logger.debug('Obteniendo productos del sistema KARDEX', filters);
      const response = await this.client.get('/productos', { params: filters });
      
      if (response.data && response.data.success) {
        logger.success(`Productos obtenidos: ${response.data.data.productos.length}`);
        return response.data.data.productos;
      }
      
      return [];
    } catch (error) {
      logger.error('Error al obtener productos', error);
      throw new Error('No se pudo obtener el catálogo de productos');
    }
  }

  /**
   * Obtener un producto específico por ID
   */
  async getProducto(id) {
    try {
      logger.debug(`Obteniendo producto ${id}`);
      
      // Primero intentar desde BD directa (más rápido y sin autenticación)
      const kardexDb = require('./kardexDb');
      if (kardexDb.isConnected()) {
        try {
          const productos = await kardexDb.buscarProductos(id.toString(), 1);
          // Buscar el producto exacto por ID
          const pool = kardexDb.getPool();
          if (pool) {
            const [rows] = await pool.execute(
              'SELECT id, nombre, codigo_interno, codigo_barras, descripcion, precio_venta, stock_actual, activo, categoria_id FROM productos WHERE id = ?',
              [id]
            );
            if (rows && rows.length > 0) {
              logger.debug(`✅ Producto ${id} obtenido de BD directa`);
              return rows[0];
            }
          }
        } catch (dbError) {
          logger.warn('Error al obtener producto de BD directa', dbError.message);
        }
      }
      
      // Fallback a API con token del chatbot
      const token = config.kardexApi.chatbotToken || process.env.CHATBOT_API_TOKEN || '';
      const response = await this.client.get(`/productos/${id}`, {
        headers: {
          'x-chatbot-token': token
        }
      });
      
      if (response.data && response.data.success) {
        return response.data.data;
      }
      
      return null;
    } catch (error) {
      logger.error(`Error al obtener producto ${id}`, error.message);
      return null;
    }
  }

  /**
   * Buscar productos por nombre o código
   */
  async buscarProductos(query, retryCount = 0) {
    try {
      logger.info('🔍 Buscando productos', { query, retryCount });
      
      const maxRetries = 3;
      const retryDelay = 1000; // 1 segundo

      try {
        const response = await this.client.get('/productos', {
          params: { 
            search: query, 
            limit: 20 
          }
        });
        
        logger.debug('Respuesta de API productos', { 
          status: response.status,
          hasData: !!response.data,
          hasSuccess: !!response.data?.success,
          dataKeys: response.data ? Object.keys(response.data) : []
        });
        
        if (response.data && response.data.success) {
          // La API puede devolver productos en diferentes formatos
          let productos = [];
          
          if (response.data.data?.productos) {
            productos = response.data.data.productos;
          } else if (Array.isArray(response.data.data)) {
            productos = response.data.data;
          } else if (response.data.productos) {
            productos = response.data.productos;
          }
          
          logger.info(`✅ Productos encontrados: ${productos.length} para "${query}"`);
          
          if (productos.length > 0) {
            logger.debug('Primer producto encontrado:', {
              id: productos[0].id,
              nombre: productos[0].nombre,
              stock: productos[0].stock_actual
            });
          }
          
          return productos;
        }
        
        logger.warn('⚠️ API no devolvió success=true', { response: response.data });
        return [];
      } catch (error) {
        // Si es error de conexión y no hemos alcanzado el máximo de reintentos
        if (retryCount < maxRetries && (
          error.code === 'ECONNREFUSED' || 
          error.code === 'ETIMEDOUT' ||
          error.response?.status >= 500
        )) {
          logger.warn(`🔄 Reintentando búsqueda (${retryCount + 1}/${maxRetries})...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay * (retryCount + 1)));
          return this.buscarProductos(query, retryCount + 1);
        }
        throw error;
      }
    } catch (error) {
      // Evitar loguear objetos circulares
      const errorMessage = error.message || error.toString();
      logger.error('❌ Error al buscar productos', {
        query,
        error: errorMessage,
        status: error.response?.status,
        serverMessage: error.response?.data?.message
      });
      return [];
    }
  }

  /**
   * Verificar stock y precios de productos
   */
  async verificarPedido(items) {
    try {
      logger.debug('Verificando pedido', { items });
      
      // Validar cada producto individualmente
      const productosVerificados = [];
      
      for (const item of items) {
        const producto = await this.getProducto(item.producto_id);
        
        if (!producto) {
          throw new Error(`Producto ${item.producto_id} no encontrado`);
        }
        
        if (!producto.activo) {
          throw new Error(`Producto ${producto.nombre} no está disponible`);
        }
        
        if (producto.stock_actual < item.cantidad) {
          throw new Error(`Stock insuficiente para ${producto.nombre}. Disponible: ${producto.stock_actual}`);
        }
        
        productosVerificados.push({
          producto_id: producto.id,
          nombre: producto.nombre,
          codigo: producto.codigo_interno,
          cantidad: item.cantidad,
          precio_unitario: producto.precio_venta,
          subtotal: producto.precio_venta * item.cantidad,
          stock_disponible: producto.stock_actual
        });
      }
      
      const total = productosVerificados.reduce((sum, item) => sum + item.subtotal, 0);
      
      logger.success('Pedido verificado correctamente', { total, items: productosVerificados.length });
      
      return {
        success: true,
        productos: productosVerificados,
        total
      };
    } catch (error) {
      logger.error('Error al verificar pedido', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Notificar pedido desde WhatsApp a vendedores/administradores
   * NO crea pedido directamente, solo notifica
   */
  async notificarPedidoWhatsApp(pedido) {
    try {
      logger.debug('Notificando pedido desde WhatsApp', pedido);
      
      // Construir mensaje de notificación con todos los detalles
      const productosTexto = pedido.productos.map(p => 
        `• ${p.nombre} - ${p.cantidad} x S/. ${p.precio_unitario.toFixed(2)} = S/. ${(p.cantidad * p.precio_unitario).toFixed(2)}`
      ).join('\n');
      
      const mensaje = `📱 Nuevo pedido desde WhatsApp

📞 Cliente: ${pedido.telefono}
${pedido.direccion ? `📍 Dirección: ${pedido.direccion}\n` : ''}
${pedido.fecha ? `📅 Fecha de entrega: ${pedido.fecha}\n` : ''}
${pedido.hora ? `⏰ Hora: ${pedido.hora}\n` : ''}
💳 Método de pago: ${pedido.metodoPago || 'YAPE'}

🛍️ Productos:
${productosTexto}

💰 Total: S/. ${pedido.total.toFixed(2)}

${pedido.observaciones ? `📝 Observaciones: ${pedido.observaciones}` : ''}

⚠️ Este pedido debe ser procesado manualmente desde el sistema.`;

      // Notificar a administradores y vendedores
      const token = config.kardexApi.chatbotToken || process.env.CHATBOT_API_TOKEN || '';
      
      const response = await this.client.post('/notificaciones/whatsapp', {
        tipo: 'SISTEMA',
        titulo: '📱 Pedido desde WhatsApp',
        mensaje: mensaje,
        metadata: {
          telefono: pedido.telefono,
          productos: pedido.productos,
          total: pedido.total,
          direccion: pedido.direccion,
          fecha: pedido.fecha,
          hora: pedido.hora,
          metodoPago: pedido.metodoPago
        },
        token: token
      }, {
        headers: {
          'x-chatbot-token': token
        }
      });
      
      if (response.data && response.data.success) {
        logger.success(`Notificación de pedido WhatsApp creada exitosamente`);
        return {
          success: true,
          notificaciones_creadas: response.data.notificaciones_creadas || 0
        };
      }
      
      throw new Error('No se pudo crear la notificación');
    } catch (error) {
      logger.error('Error al notificar pedido WhatsApp', error);
      // Intentar notificar de forma alternativa si el endpoint no existe
      logger.warn('Intentando notificación alternativa...');
      return {
        success: false,
        error: error.response?.data?.message || error.message
      };
    }
  }

  /**
   * Actualizar estado de una venta
   */
  async actualizarEstadoVenta(ventaId, nuevoEstado) {
    try {
      logger.debug(`Actualizando estado de venta ${ventaId} a ${nuevoEstado}`);
      
      const response = await this.client.patch(`/ventas/${ventaId}`, {
        estado: nuevoEstado
      });
      
      if (response.data && response.data.success) {
        logger.success(`Estado de venta ${ventaId} actualizado`);
        return { success: true };
      }
      
      return { success: false };
    } catch (error) {
      logger.error('Error al actualizar estado de venta', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Crear venta/factura en KARDEX
   */
  async crearVenta(ventaData) {
    try {
      logger.info('📄 Creando venta/factura en KARDEX', { cliente_id: ventaData.cliente_id });
      
      const response = await this.client.post('/ventas', {
        cliente_id: ventaData.cliente_id,
        fecha_venta: ventaData.fecha_venta || new Date().toISOString(),
        subtotal: ventaData.subtotal || ventaData.total,
        descuento: ventaData.descuento || 0,
        impuestos: ventaData.impuestos || 0,
        total: ventaData.total,
        metodo_pago: ventaData.metodo_pago || 'TRANSFERENCIA',
        estado: 'PROCESADA',
        observaciones: ventaData.observaciones || `Pedido desde WhatsApp - ${ventaData.telefono}`,
        detalles: ventaData.detalles.map(detalle => ({
          producto_id: detalle.producto_id,
          cantidad: detalle.cantidad,
          precio_unitario: detalle.precio_unitario,
          subtotal: detalle.cantidad * detalle.precio_unitario
        }))
      });
      
      if (response.data && response.data.success) {
        const venta = response.data.data;
        logger.success(`✅ Venta creada: ${venta.numero_factura}`);
        return {
          success: true,
          venta: venta,
          numero_factura: venta.numero_factura,
          venta_id: venta.id
        };
      }
      
      throw new Error('No se pudo crear la venta');
    } catch (error) {
      logger.error('Error al crear venta', error);
      return {
        success: false,
        error: error.response?.data?.message || error.message
      };
    }
  }

  /**
   * Obtener PDF de factura
   */
  async obtenerFacturaPDF(ventaId) {
    try {
      logger.debug(`Obteniendo PDF de factura ${ventaId}`);
      const response = await this.client.get(`/ventas/${ventaId}/pdf`, {
        responseType: 'arraybuffer'
      });
      
      return Buffer.from(response.data);
    } catch (error) {
      logger.error('Error al obtener PDF de factura', error);
      return null;
    }
  }

  /**
   * Crear pedido en KARDEX desde WhatsApp
   */
  async crearPedido(pedidoData) {
    try {
      logger.info('📦 Creando pedido en KARDEX desde WhatsApp', { cliente_id: pedidoData.cliente_id });
      
      // Usar endpoint especial de WhatsApp que no requiere autenticación de usuario
      const token = config.kardexApi.chatbotToken || process.env.CHATBOT_API_TOKEN || '';
      
      const response = await this.client.post('/pedidos/whatsapp', {
        cliente_id: pedidoData.cliente_id,
        tipo_pedido: pedidoData.tipo_pedido || 'COMPRA_DIRECTA',
        detalles: pedidoData.detalles.map(detalle => ({
          producto_id: detalle.producto_id,
          cantidad: detalle.cantidad,
          descuento: detalle.descuento || 0
        })),
        observaciones: pedidoData.observaciones || `Pedido desde WhatsApp - ${pedidoData.telefono || 'N/A'}`,
        telefono: pedidoData.telefono || null
      }, {
        headers: {
          'x-chatbot-token': token
        }
      });
      
      if (response.data && response.data.success) {
        const pedido = response.data.data;
        logger.success(`✅ Pedido creado: ${pedido.numero_pedido} (ID: ${pedido.id})`);
        return {
          success: true,
          pedido: pedido,
          pedido_id: pedido.id,
          numero_pedido: pedido.numero_pedido,
          estado: pedido.estado
        };
      }
      
      throw new Error('No se pudo crear el pedido');
    } catch (error) {
      logger.error('Error al crear pedido', error);
      return {
        success: false,
        error: error.response?.data?.message || error.message
      };
    }
  }

  /**
   * Crear pedido vacío en proceso
   */
  async crearPedidoVacio(clienteId, telefono) {
    try {
      logger.info('📦 Creando pedido vacío en KARDEX', { cliente_id: clienteId });
      
      const token = config.kardexApi.chatbotToken || process.env.CHATBOT_API_TOKEN || '';
      
      const response = await this.client.post('/pedidos/whatsapp/vacio', {
        cliente_id: clienteId,
        telefono: telefono
      }, {
        headers: {
          'x-chatbot-token': token
        }
      });
      
      if (response.data && response.data.success) {
        const pedido = response.data.data;
        logger.success(`✅ Pedido vacío creado: ${pedido.numero_pedido} (ID: ${pedido.id})`);
        return {
          success: true,
          pedido_id: pedido.id,
          numero_pedido: pedido.numero_pedido,
          estado: pedido.estado
        };
      }
      
      throw new Error('No se pudo crear el pedido vacío');
    } catch (error) {
      const errorMsg = error.response?.data?.message || error.message || 'Error desconocido';
      const statusCode = error.response?.status || 'N/A';
      logger.error(`Error al crear pedido vacío: ${errorMsg} (Status: ${statusCode})`);
      return {
        success: false,
        error: errorMsg
      };
    }
  }

  /**
   * Agregar producto a pedido en proceso
   */
  async agregarProductoAPedido(pedidoId, productoId, cantidad) {
    try {
      logger.info('➕ Agregando producto a pedido', { pedido_id: pedidoId, producto_id: productoId, cantidad });
      
      const token = config.kardexApi.chatbotToken || process.env.CHATBOT_API_TOKEN || '';
      
      const response = await this.client.post('/pedidos/whatsapp/agregar-producto', {
        pedido_id: pedidoId,
        producto_id: productoId,
        cantidad: cantidad
      }, {
        headers: {
          'x-chatbot-token': token
        }
      });
      
      if (response.data && response.data.success) {
        const pedido = response.data.data;
        logger.success(`✅ Producto agregado al pedido ${pedido.numero_pedido}`);
        return {
          success: true,
          pedido: pedido,
          total: parseFloat(pedido.total)
        };
      }
      
      throw new Error(response.data?.message || 'No se pudo agregar el producto');
    } catch (error) {
      logger.error('Error al agregar producto al pedido', error);
      return {
        success: false,
        error: error.response?.data?.message || error.message
      };
    }
  }

  /**
   * Eliminar producto de pedido en proceso
   */
  async eliminarProductoDePedido(pedidoId, detalleId) {
    try {
      logger.info('➖ Eliminando producto de pedido', { pedido_id: pedidoId, detalle_id: detalleId });
      
      const token = config.kardexApi.chatbotToken || process.env.CHATBOT_API_TOKEN || '';
      
      const response = await this.client.post('/pedidos/whatsapp/eliminar-producto', {
        pedido_id: pedidoId,
        detalle_id: detalleId
      }, {
        headers: {
          'x-chatbot-token': token
        }
      });
      
      if (response.data && response.data.success) {
        logger.success(`✅ Producto eliminado del pedido`);
        return { success: true };
      }
      
      throw new Error(response.data?.message || 'No se pudo eliminar el producto');
    } catch (error) {
      logger.error('Error al eliminar producto del pedido', error);
      return {
        success: false,
        error: error.response?.data?.message || error.message
      };
    }
  }

  /**
   * Actualizar cantidad de un producto en el pedido
   */
  async actualizarCantidadProducto(pedidoId, detalleId, nuevaCantidad) {
    try {
      logger.info('🔄 Actualizando cantidad de producto', { pedido_id: pedidoId, detalle_id: detalleId, nueva_cantidad: nuevaCantidad });
      
      const token = config.kardexApi.chatbotToken || process.env.CHATBOT_API_TOKEN || '';
      
      const response = await this.client.patch(`/pedidos/${pedidoId}/detalles/${detalleId}`, {
        cantidad: nuevaCantidad
      }, {
        headers: {
          'x-chatbot-token': token
        }
      });
      
      if (response.data && response.data.success) {
        logger.success(`✅ Cantidad actualizada en el pedido`);
        return { 
          success: true,
          pedido: response.data.data
        };
      }
      
      throw new Error(response.data?.message || 'No se pudo actualizar la cantidad');
    } catch (error) {
      logger.error('Error al actualizar cantidad de producto', error);
      return {
        success: false,
        error: error.response?.data?.message || error.message
      };
    }
  }

  /**
   * Listar productos del pedido actual (helper)
   */
  async listarProductosPedido(pedidoId) {
    try {
      const pedido = await this.getPedidoEnProceso(pedidoId);
      if (!pedido) {
        return { success: false, productos: [] };
      }

      return {
        success: true,
        productos: pedido.detalles || [],
        total: pedido.total || 0,
        numero_pedido: pedido.numero_pedido
      };
    } catch (error) {
      logger.error('Error al listar productos del pedido', error);
      return { success: false, productos: [] };
    }
  }

  /**
   * Obtener pedido en proceso
   */
  async getPedidoEnProceso(pedidoId) {
    try {
      logger.debug(`Obteniendo pedido en proceso: ${pedidoId}`);
      
      const token = config.kardexApi.chatbotToken || process.env.CHATBOT_API_TOKEN || '';
      
      const response = await this.client.get(`/pedidos/whatsapp/${pedidoId}`, {
        headers: {
          'x-chatbot-token': token
        },
        params: {
          token: token
        }
      });
      
      if (response.data && response.data.success) {
        return response.data.data;
      }
      
      return null;
    } catch (error) {
      logger.error('Error al obtener pedido en proceso', error);
      return null;
    }
  }

  /**
   * Cancelar pedido en proceso
   */
  async cancelarPedidoEnProceso(pedidoId) {
    try {
      logger.info(`❌ Cancelando pedido: ${pedidoId}`);
      
      const token = config.kardexApi.chatbotToken || process.env.CHATBOT_API_TOKEN || '';
      
      const response = await this.client.post('/pedidos/whatsapp/cancelar', {
        pedido_id: pedidoId
      }, {
        headers: {
          'x-chatbot-token': token
        }
      });
      
      if (response.data && response.data.success) {
        logger.success(`✅ Pedido cancelado: ${pedidoId}`);
        return { success: true };
      }
      
      throw new Error(response.data?.message || 'No se pudo cancelar el pedido');
    } catch (error) {
      logger.error('Error al cancelar pedido', error);
      return {
        success: false,
        error: error.response?.data?.message || error.message
      };
    }
  }

  /**
   * Cancelar pedido confirmado (requiere autenticación)
   */
  async cancelarPedido(pedidoId, userToken = null) {
    try {
      if (!userToken) {
        logger.warn('cancelarPedido requiere token de autenticación');
        return { success: false, message: 'No autenticado' };
      }

      logger.info(`❌ Cancelando pedido confirmado: ${pedidoId}`);
      
      const response = await this.client.patch(`/pedidos/${pedidoId}`, {
        estado: 'CANCELADO'
      }, {
        headers: {
          'Authorization': `Bearer ${userToken}`
        }
      });

      if (response.data && response.data.success) {
        logger.success(`✅ Pedido confirmado cancelado: ${pedidoId}`);
        return { success: true, data: response.data.data };
      }

      return { success: false, message: 'No se pudo cancelar el pedido' };
    } catch (error) {
      logger.error('Error al cancelar pedido confirmado', error);
      return {
        success: false,
        message: error.response?.data?.message || 'Error al cancelar el pedido'
      };
    }
  }

  /**
   * Obtener pedidos del cliente (requiere autenticación)
   */
  async getMisPedidos(userToken = null) {
    try {
      if (!userToken) {
        logger.warn('getMisPedidos requiere token de autenticación');
        return { success: false, data: [], message: 'No autenticado' };
      }

      logger.debug('Obteniendo pedidos del cliente autenticado');
      
      const response = await this.client.get('/pedidos/mis-pedidos', {
        headers: {
          'Authorization': `Bearer ${userToken}`
        }
      });

      if (response.data && response.data.success) {
        return {
          success: true,
          data: response.data.data || []
        };
      }

      return { success: false, data: [], message: 'No se pudieron obtener los pedidos' };
    } catch (error) {
      logger.error('Error al obtener pedidos del cliente', error);
      return {
        success: false,
        data: [],
        message: error.response?.data?.message || 'Error al obtener pedidos'
      };
    }
  }

  /**
   * Obtener historial de compras del cliente (requiere autenticación)
   */
  async getMisCompras(userToken = null, page = 1, limit = 10) {
    try {
      if (!userToken) {
        logger.warn('getMisCompras requiere token de autenticación');
        return { success: false, data: [], message: 'No autenticado' };
      }

      logger.debug(`Obteniendo historial de compras (página ${page}, límite ${limit})`);
      
      const response = await this.client.get('/cliente-portal/mis-compras', {
        headers: {
          'Authorization': `Bearer ${userToken}`
        },
        params: {
          page,
          limit
        }
      });

      if (response.data && response.data.success) {
        return {
          success: true,
          data: response.data.data || [],
          total: response.data.total || 0
        };
      }

      return { success: false, data: [], message: 'No se pudieron obtener las compras' };
    } catch (error) {
      logger.error('Error al obtener historial de compras', error);
      return {
        success: false,
        data: [],
        message: error.response?.data?.message || 'Error al obtener historial de compras'
      };
    }
  }

  /**
   * Obtener facturas del cliente (requiere autenticación)
   */
  async getMisFacturas(userToken = null, page = 1, limit = 10) {
    try {
      if (!userToken) {
        logger.warn('getMisFacturas requiere token de autenticación');
        return { success: false, data: [], message: 'No autenticado' };
      }

      logger.debug(`Obteniendo facturas del cliente (página ${page}, límite ${limit})`);
      
      const response = await this.client.get('/cliente-portal/mis-facturas', {
        headers: {
          'Authorization': `Bearer ${userToken}`
        },
        params: {
          page,
          limit
        }
      });

      if (response.data && response.data.success) {
        return {
          success: true,
          data: response.data.data || [],
          total: response.data.total || 0
        };
      }

      return { success: false, data: [], message: 'No se pudieron obtener las facturas' };
    } catch (error) {
      logger.error('Error al obtener facturas del cliente', error);
      return {
        success: false,
        data: [],
        message: error.response?.data?.message || 'Error al obtener facturas'
      };
    }
  }

  /**
   * Obtener detalle de un pedido específico (requiere autenticación)
   */
  async getDetallePedido(pedidoId, userToken = null) {
    try {
      if (!userToken) {
        logger.warn('getDetallePedido requiere token de autenticación');
        return { success: false, data: null, message: 'No autenticado' };
      }

      logger.debug(`Obteniendo detalle del pedido ${pedidoId}`);
      
      const response = await this.client.get(`/pedidos/${pedidoId}`, {
        headers: {
          'Authorization': `Bearer ${userToken}`
        }
      });

      if (response.data && response.data.success) {
        return {
          success: true,
          data: response.data.data
        };
      }

      return { success: false, data: null, message: 'No se pudo obtener el detalle del pedido' };
    } catch (error) {
      logger.error(`Error al obtener detalle del pedido ${pedidoId}`, error);
      return {
        success: false,
        data: null,
        message: error.response?.data?.message || 'Error al obtener detalle del pedido'
      };
    }
  }

  /**
   * Obtener detalle de una compra específica (requiere autenticación)
   */
  async getDetalleCompra(ventaId, userToken = null) {
    try {
      if (!userToken) {
        logger.warn('getDetalleCompra requiere token de autenticación');
        return { success: false, data: null, message: 'No autenticado' };
      }

      logger.debug(`Obteniendo detalle de la compra ${ventaId}`);
      
      const response = await this.client.get(`/cliente-portal/mis-compras/${ventaId}`, {
        headers: {
          'Authorization': `Bearer ${userToken}`
        }
      });

      if (response.data && response.data.success) {
        return {
          success: true,
          data: response.data.data
        };
      }

      return { success: false, data: null, message: 'No se pudo obtener el detalle de la compra' };
    } catch (error) {
      logger.error(`Error al obtener detalle de la compra ${ventaId}`, error);
      return {
        success: false,
        data: null,
        message: error.response?.data?.message || 'Error al obtener detalle de la compra'
      };
    }
  }

  /**
   * Obtener pedido por ID
   */
  async getPedidoById(pedidoId) {
    try {
      logger.debug(`Obteniendo pedido ${pedidoId}`);
      const response = await this.client.get(`/pedidos/${pedidoId}`);
      
      if (response.data && response.data.success) {
        return response.data.data;
      }
      
      return null;
    } catch (error) {
      logger.error(`Error al obtener pedido ${pedidoId}`, error);
      return null;
    }
  }

  /**
   * Actualizar estado de un pedido
   */
  async actualizarEstadoPedido(pedidoId, nuevoEstado) {
    try {
      logger.debug(`Actualizando estado de pedido ${pedidoId} a ${nuevoEstado}`);
      
      const response = await this.client.patch(`/pedidos/${pedidoId}`, {
        estado: nuevoEstado
      });
      
      if (response.data && response.data.success) {
        logger.success(`Estado de pedido ${pedidoId} actualizado`);
        return { success: true };
      }
      
      return { success: false };
    } catch (error) {
      logger.error('Error al actualizar estado de pedido', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Verificar la salud del API
   */
  async checkHealth() {
    try {
      const response = await this.client.get('/health');
      return response.status === 200;
    } catch (error) {
      logger.error('API KARDEX no disponible', error);
      return false;
    }
  }

  /**
   * Actualizar datos del cliente (requiere autenticación)
   */
  async actualizarCliente(clienteId, datos, userToken = null) {
    try {
      if (!userToken) {
        logger.warn('actualizarCliente requiere token de autenticación');
        return { success: false, message: 'No autenticado' };
      }

      logger.info(`🔄 Actualizando cliente ${clienteId}`, { datos });

      const response = await this.client.patch(`/clientes/${clienteId}`, datos, {
        headers: {
          'Authorization': `Bearer ${userToken}`
        }
      });

      if (response.data && response.data.success) {
        logger.success(`✅ Cliente ${clienteId} actualizado`);
        return { success: true, data: response.data.data };
      }

      return { success: false, message: 'No se pudo actualizar el cliente' };
    } catch (error) {
      logger.error('Error al actualizar cliente', error);
      return {
        success: false,
        message: error.response?.data?.message || 'Error al actualizar cliente'
      };
    }
  }

  /**
   * Obtener estado de cuenta del cliente (requiere autenticación)
   */
  async getEstadoCuenta(userToken = null) {
    try {
      if (!userToken) {
        logger.warn('getEstadoCuenta requiere token de autenticación');
        return { success: false, message: 'No autenticado' };
      }

      logger.debug('Obteniendo estado de cuenta del cliente');

      const response = await this.client.get('/cliente-portal/estado-cuenta', {
        headers: {
          'Authorization': `Bearer ${userToken}`
        }
      });

      if (response.data && response.data.success) {
        return {
          success: true,
          data: response.data.data
        };
      }

      return { success: false, message: 'No se pudo obtener el estado de cuenta' };
    } catch (error) {
      logger.error('Error al obtener estado de cuenta', error);
      return {
        success: false,
        message: error.response?.data?.message || 'Error al obtener estado de cuenta'
      };
    }
  }
}

module.exports = new KardexAPI();

