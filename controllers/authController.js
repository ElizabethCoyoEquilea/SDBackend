const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User } = require('../models');

const authController = {
  // Registro de usuario
  register: async (req, res) => {
    try {
      console.log('🔍 [Register] Request body:', req.body);
      const { nombre, email, password } = req.body;

      // Validar que se proporcionen todos los campos
      if (!nombre || !email || !password) {
        console.log('❌ [Register] Missing fields');
        return res.status(400).json({ error: 'Todos los campos son requeridos' });
      }

      console.log('🔍 [Register] Checking if user exists:', email);
      // Verificar si el usuario ya existe
      const existingUser = await User.findOne({ where: { email } });
      if (existingUser) {
        console.log('❌ [Register] User already exists');
        return res.status(400).json({ error: 'El usuario ya existe con este email' });
      }

      console.log('🔍 [Register] Hashing password...');
      // Hash de la contraseña
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(password, saltRounds);

      console.log('🔍 [Register] Creating user in database...');
      // Crear usuario
      const newUser = await User.create({
        nombre,
        email,
        password: hashedPassword
      });

      console.log('✅ [Register] User created successfully:', newUser.id);

      // Verificar JWT_SECRET
      if (!process.env.JWT_SECRET) {
        console.error('❌ [Register] JWT_SECRET not configured');
        return res.status(500).json({ error: 'Configuración del servidor incompleta' });
      }

      console.log('🔍 [Register] Generating JWT token...');
      // Generar token JWT
      const token = jwt.sign(
        { userId: newUser.id, email: newUser.email },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
      );

      console.log('✅ [Register] Registration successful');
      res.status(201).json({
        message: 'Usuario registrado exitosamente',
        token,
        user: {
          id: newUser.id,
          nombre: newUser.nombre,
          email: newUser.email
        }
      });

    } catch (error) {
      console.error('❌ [Register] Error completo:', error);
      console.error('❌ [Register] Error stack:', error.stack);
      res.status(500).json({ 
        error: 'Error interno del servidor',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  },

  // Login de usuario
  login: async (req, res) => {
    try {
      console.log('[authController] Login solicitado');
      console.log('[authController] Email recibido:', req.body.email);
      const { email, password } = req.body;

      // Validar campos
      if (!email || !password) {
        return res.status(400).json({ error: 'Email y contraseña son requeridos' });
      }

      // Buscar usuario
      const user = await User.findOne({ where: { email } });
      if (!user) {
        return res.status(401).json({ error: 'Credenciales inválidas' });
      }

      // Verificar contraseña
      const isValidPassword = await bcrypt.compare(password, user.password);
      if (!isValidPassword) {
        return res.status(401).json({ error: 'Credenciales inválidas' });
      }

      // Generar token JWT
      const token = jwt.sign(
        { userId: user.id, email: user.email },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
      );

      res.json({
        message: 'Login exitoso',
        token,
        user: {
          id: user.id,
          nombre: user.nombre,
          email: user.email
        }
      });

    } catch (error) {
      console.error('Error en login:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  },

  // Obtener perfil del usuario
  getProfile: async (req, res) => {
    try {
      const user = await User.findByPk(req.user.userId, {
        attributes: ['id', 'nombre', 'email', 'createdAt']
      });

      if (!user) {
        return res.status(404).json({ error: 'Usuario no encontrado' });
      }

      res.json({ user });

    } catch (error) {
      console.error('Error al obtener perfil:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  }
};

module.exports = authController;