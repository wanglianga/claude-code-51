export const config = {
  port: Number(process.env.PORT || 3000),
  databaseUrl:
    process.env.DATABASE_URL ||
    'postgres://senior:senior123@localhost:5432/senior_university',
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
};
