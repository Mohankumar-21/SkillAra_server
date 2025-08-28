import swaggerJSDoc from "swagger-jsdoc";
import path from "path";

const swaggerOptions = {
  swaggerDefinition: {
    openapi: "3.0.0",
    info: {
      title: "SkillAra API",
      version: "1.0.0",
      description: "API documentation for SkillAra Online Learning Platform",
    },
    servers: [
      {
        url: "http://localhost:5000/api", 
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: [
    path.join(process.cwd(), "swagger/*.yaml"), // all module YAMLs
    path.join(process.cwd(), "swagger/schema/*.yaml"), // optional schema folder
  ],
};

const swaggerSpec = swaggerJSDoc(swaggerOptions);

export default swaggerSpec;
