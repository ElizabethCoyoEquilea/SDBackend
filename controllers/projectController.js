const { Project, User } = require('../models');

const projectController = {
  // Crear nuevo proyecto
  create: async (req, res) => {
    try {
      const { nombre, descripcion, contenido_diagrama } = req.body;
      const usuario_id = req.user.userId;

      // Validar campos requeridos
      if (!nombre || !contenido_diagrama) {
        return res.status(400).json({ error: 'Nombre y contenido del diagrama son requeridos' });
      }

      // Convertir contenido_diagrama a JSON string si es un objeto
      const contenidoJson = typeof contenido_diagrama === 'object' 
        ? JSON.stringify(contenido_diagrama) 
        : contenido_diagrama;

      const newProject = await Project.create({
        nombre,
        descripcion,
        contenido_diagrama: contenidoJson,
        usuario_id
      });

      res.status(201).json({
        message: 'Proyecto creado exitosamente',
        project: newProject
      });

    } catch (error) {
      console.error('Error al crear proyecto:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  },

  // Obtener todos los proyectos del usuario
  getAll: async (req, res) => {
    try {
      const usuario_id = req.user.userId;

      const projects = await Project.findAll({
        where: { usuario_id },
        attributes: ['id', 'nombre', 'descripcion', 'contenido_diagrama', 'createdAt', 'updatedAt'],
        order: [['updatedAt', 'DESC']]
      });

      // Asegurar que contenido_diagrama se devuelva como objeto JSON
      const projectsWithParsedContent = projects.map(project => {
        const projectData = project.toJSON();
        
        // Si contenido_diagrama es string, parsearlo a objeto
        if (typeof projectData.contenido_diagrama === 'string') {
          try {
            projectData.contenido_diagrama = JSON.parse(projectData.contenido_diagrama);
          } catch (error) {
            console.error('Error parsing contenido_diagrama for project', project.id, error);
            projectData.contenido_diagrama = null;
          }
        }
        
        return projectData;
      });

      res.json({ projects: projectsWithParsedContent });

    } catch (error) {
      console.error('Error al obtener proyectos:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  },

  // Obtener un proyecto específico
  getById: async (req, res) => {
    try {
      const { id } = req.params;
      const usuario_id = req.user.userId;

      const project = await Project.findOne({
        where: { id, usuario_id }
      });

      if (!project) {
        return res.status(404).json({ error: 'Proyecto no encontrado' });
      }

      const projectData = project.toJSON();
      
      // Si contenido_diagrama es string, parsearlo a objeto
      if (typeof projectData.contenido_diagrama === 'string') {
        try {
          projectData.contenido_diagrama = JSON.parse(projectData.contenido_diagrama);
        } catch (error) {
          console.error('Error parsing contenido_diagrama for project', project.id, error);
          projectData.contenido_diagrama = null;
        }
      }

      res.json({ project: projectData });

    } catch (error) {
      console.error('Error al obtener proyecto:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  },

  // Actualizar proyecto
  update: async (req, res) => {
    try {
      const { id } = req.params;
      const { nombre, descripcion, contenido_diagrama } = req.body;
      const usuario_id = req.user.userId;

      const project = await Project.findOne({
        where: { id, usuario_id }
      });

      if (!project) {
        return res.status(404).json({ error: 'Proyecto no encontrado' });
      }

      // Convertir contenido_diagrama a JSON string si es un objeto
      const contenidoJson = contenido_diagrama && typeof contenido_diagrama === 'object' 
        ? JSON.stringify(contenido_diagrama) 
        : contenido_diagrama;

      await project.update({
        nombre: nombre || project.nombre,
        descripcion: descripcion !== undefined ? descripcion : project.descripcion,
        contenido_diagrama: contenidoJson || project.contenido_diagrama
      });

      res.json({
        message: 'Proyecto actualizado exitosamente',
        project
      });

    } catch (error) {
      console.error('Error al actualizar proyecto:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  },

  // Eliminar proyecto
  delete: async (req, res) => {
    try {
      const { id } = req.params;
      const usuario_id = req.user.userId;

      const project = await Project.findOne({
        where: { id, usuario_id }
      });

      if (!project) {
        return res.status(404).json({ error: 'Proyecto no encontrado' });
      }

      await project.destroy();

      res.json({ message: 'Proyecto eliminado exitosamente' });

    } catch (error) {
      console.error('Error al eliminar proyecto:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  }
};

module.exports = projectController;