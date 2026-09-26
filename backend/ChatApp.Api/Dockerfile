# Build with the backend directory as the Docker context.
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY . .
RUN dotnet restore ChatApp.Api/ChatApp.Api.csproj
RUN dotnet publish ChatApp.Api/ChatApp.Api.csproj -c Release --no-restore -o /app/publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final
WORKDIR /app
COPY --from=build /app/publish .
ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080
RUN mkdir -p /app/uploads /app/upload-cache && chown -R $APP_UID /app/uploads /app/upload-cache
USER $APP_UID
ENTRYPOINT ["dotnet", "ChatApp.Api.dll"]
