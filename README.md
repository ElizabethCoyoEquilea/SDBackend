# Backend - Diagramador UML

## Funcionalidades

✅ **Autenticación de usuarios**
- Registro de nuevos usuarios
- Login con JWT
- Protección de rutas con middleware

✅ **Gestión de proyectos UML**
- Crear, leer, actualizar y eliminar proyectos
- Cada proyecto almacena el contenido del diagrama en JSON
- Relación usuario-proyectos (un usuario puede tener múltiples proyectos)

## Configuración

### 1. Variables de entorno
Crea o actualiza el archivo `.env` con:

```env
DB_NAME=diagramador_uml
DB_USER=tu_usuario_postgres
DB_PASS=tu_contraseña_postgres
DB_HOST=localhost
PORT=3001
JWT_SECRET=tu_clave_secreta_muy_segura_aqui_2024
```

### 2. Base de datos PostgreSQL
Asegúrate de tener PostgreSQL instalado y crea una base de datos:

```sql
CREATE DATABASE diagramador_uml;
```

### 3. Instalar dependencias
```bash
pnpm install
```

### 4. Configurar base de datos (primera vez)
```bash
pnpm run setup-db
```

Este comando:
- Crea las tablas en la base de datos
- Inserta un usuario de prueba (test@example.com / test123)
- Crea un proyecto de ejemplo

## Ejecutar el servidor

### Desarrollo (con WebSocket)
```bash
pnpm run dev
```

### Solo API REST
```bash
pnpm start
```

## API Endpoints

### Autenticación

**POST** `/api/auth/register`
```json
{
  "nombre": "Nombre Usuario",
  "email": "usuario@email.com",
  "password": "contraseña123"
}
```

**POST** `/api/auth/login`
```json
{
  "email": "usuario@email.com",
  "password": "contraseña123"
}
```

**GET** `/api/auth/profile` (requiere token)
- Header: `Authorization: Bearer <token>`

### Proyectos (todas requieren autenticación)

**GET** `/api/projects` - Obtener todos los proyectos del usuario

**POST** `/api/projects` - Crear nuevo proyecto
```json
{
  "nombre": "Mi Proyecto UML",
  "descripcion": "Descripción opcional",
  "contenido_diagrama": {
    "nodes": [...],
    "edges": [...]
  }
}
```

**GET** `/api/projects/:id` - Obtener proyecto específico

**PUT** `/api/projects/:id` - Actualizar proyecto

**DELETE** `/api/projects/:id` - Eliminar proyecto

## Estructura de Base de Datos

### Tabla: usuarios
- id (PRIMARY KEY)
- nombre
- email (UNIQUE)
- password (hash)
- createdAt, updatedAt

### Tabla: trabajos
- id (PRIMARY KEY)
- nombre
- descripcion
- contenido_diagrama (JSON)
- usuario_id (FOREIGN KEY)
- createdAt, updatedAt

## Usuario de Prueba

Después de ejecutar `pnpm run setup-db`:
- **Email:** test@example.com
- **Contraseña:** test123

## 🚀 Despliegue en Render

### Opción 1: Usando render.yaml (Recomendado)

1. Sube este repositorio a GitHub
2. Conecta tu repositorio en Render.com
3. Render detectará automáticamente el archivo `render.yaml` y configurará:
   - El servicio web con Node.js
   - La base de datos PostgreSQL
   - Las variables de entorno necesarias

### Opción 2: Configuración manual

1. **Crear servicio web en Render:**
   - Tipo: Web Service
   - Runtime: Node
   - Build Command: `npm install`
   - Start Command: `npm start`

2. **Crear base de datos PostgreSQL:**
   - Plan: Free (o el que prefieras)
   - Anota las credenciales

3. **Configurar variables de entorno:**
   ```
   NODE_ENV=production
   DB_NAME=tu_nombre_base_datos
   DB_USER=tu_usuario_db
   DB_PASS=tu_password_db
   DB_HOST=tu_host_db
   DB_PORT=5432
   JWT_SECRET=tu_clave_secreta_jwt
   ```

## 📋 Variables de entorno para producción

- `DB_NAME`: Nombre de la base de datos PostgreSQL
- `DB_USER`: Usuario de la base de datos
- `DB_PASS`: Contraseña de la base de datos
- `DB_HOST`: Host de la base de datos
- `DB_PORT`: Puerto de la base de datos (por defecto: 5432)
- `JWT_SECRET`: Clave secreta para JWT tokens (genera una segura)
- `NODE_ENV`: production