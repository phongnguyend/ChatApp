-- Connect directly to the deployed application database (not master) as a
-- configured Microsoft Entra SQL administrator user or a member of its admin group.
-- Set these names from the deployment outputs. Leave FunctionAppName NULL
-- if no Function App is deployed. Run before publishing the applications.
SET XACT_ABORT ON;
DECLARE @ApiAppName sysname = NULL;
DECLARE @FunctionAppName sysname = NULL;

IF DB_NAME() = N'master'
    THROW 50000, 'Connect to the application database, not master.', 1;
IF NULLIF(@ApiAppName, N'') IS NULL
    THROW 50000, 'Set @ApiAppName from the apiAppName deployment output.', 1;

BEGIN TRANSACTION;
DECLARE @Name sysname, @RunsMigrations bit, @Sql nvarchar(max);
DECLARE identities CURSOR LOCAL FAST_FORWARD FOR
    SELECT @ApiAppName, CAST(1 AS bit)
    UNION ALL
    SELECT @FunctionAppName, CAST(0 AS bit)
    WHERE NULLIF(@FunctionAppName, N'') IS NOT NULL;
OPEN identities;
FETCH NEXT FROM identities INTO @Name, @RunsMigrations;
WHILE @@FETCH_STATUS = 0
BEGIN
    IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = @Name AND type <> 'E')
        THROW 50000, 'A non-Entra principal already uses this name.', 1;
    IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = @Name)
    BEGIN
        SET @Sql = N'CREATE USER ' + QUOTENAME(@Name) + N' FROM EXTERNAL PROVIDER;';
        EXEC sp_executesql @Sql;
    END;
    SET @Sql = N'GRANT CONNECT TO ' + QUOTENAME(@Name) + N';';
    IF IS_ROLEMEMBER(N'db_datareader', @Name) = 0
        SET @Sql += N'ALTER ROLE db_datareader ADD MEMBER ' + QUOTENAME(@Name) + N';';
    IF IS_ROLEMEMBER(N'db_datawriter', @Name) = 0
        SET @Sql += N'ALTER ROLE db_datawriter ADD MEMBER ' + QUOTENAME(@Name) + N';';
    -- The API applies EF migrations at startup. The worker only needs data access.
    IF @RunsMigrations = 1 AND IS_ROLEMEMBER(N'db_ddladmin', @Name) = 0
        SET @Sql += N'ALTER ROLE db_ddladmin ADD MEMBER ' + QUOTENAME(@Name) + N';';
    EXEC sp_executesql @Sql;
    FETCH NEXT FROM identities INTO @Name, @RunsMigrations;
END;
CLOSE identities;
DEALLOCATE identities;
COMMIT TRANSACTION;
