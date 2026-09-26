-- Run against the migrated ChatApp database. Set the existing user ID and role.
SET XACT_ABORT ON;
DECLARE @UserId uniqueidentifier = NULL;
DECLARE @RoleName nvarchar(256) = N'Global Admin'; -- User or Global Admin

IF @UserId IS NULL OR NOT EXISTS (SELECT 1 FROM dbo.Users WHERE Id = @UserId)
    THROW 50000, 'Set @UserId to an existing Users.Id.', 1;
IF @RoleName NOT IN (N'User', N'Global Admin')
    THROW 50000, 'Role must be User or Global Admin.', 1;

BEGIN TRANSACTION;
DECLARE @RoleId uniqueidentifier;
SELECT @RoleId = Id FROM dbo.AspNetRoles WITH (UPDLOCK, HOLDLOCK)
WHERE NormalizedName = UPPER(@RoleName);
IF @RoleId IS NULL
BEGIN
    -- SQL Server generates the ID using NEWSEQUENTIALID().
    INSERT dbo.AspNetRoles (Name, NormalizedName, ConcurrencyStamp)
    VALUES (@RoleName, UPPER(@RoleName), CONVERT(varchar(64), CRYPT_GEN_RANDOM(32), 2));
    SELECT @RoleId = Id FROM dbo.AspNetRoles WHERE NormalizedName = UPPER(@RoleName);
END;

IF NOT EXISTS (SELECT 1 FROM dbo.AspNetUserRoles WITH (UPDLOCK, HOLDLOCK)
               WHERE UserId = @UserId AND RoleId = @RoleId)
BEGIN
    INSERT dbo.AspNetUserRoles (UserId, RoleId) VALUES (@UserId, @RoleId);
    INSERT dbo.ActivityLogs (OccurredAt, EventType, EntityType, EntityId, EntityName, Metadata)
    SELECT SYSUTCDATETIME(), N'RolesChanged', N'User', CONVERT(nvarchar(36), Id), Username,
           (SELECT N'ManualRoleAssignment' AS reason, @RoleName AS addedRole FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
    FROM dbo.Users WHERE Id = @UserId;
END;
COMMIT TRANSACTION;
