using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ChatApp.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddUserTaskAssignee : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "AssigneeUserId",
                table: "UserTasks",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_UserTasks_AssigneeUserId",
                table: "UserTasks",
                column: "AssigneeUserId");

            migrationBuilder.AddForeignKey(
                name: "FK_UserTasks_Users_AssigneeUserId",
                table: "UserTasks",
                column: "AssigneeUserId",
                principalTable: "Users",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_UserTasks_Users_AssigneeUserId",
                table: "UserTasks");

            migrationBuilder.DropIndex(
                name: "IX_UserTasks_AssigneeUserId",
                table: "UserTasks");

            migrationBuilder.DropColumn(
                name: "AssigneeUserId",
                table: "UserTasks");
        }
    }
}
