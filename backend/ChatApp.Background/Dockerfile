# Build with the backend directory as the Docker context.
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY . .
RUN dotnet restore ChatApp.Background/ChatApp.Background.csproj
RUN dotnet publish ChatApp.Background/ChatApp.Background.csproj -c Release --no-restore -o /app/publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/runtime:10.0 AS final
WORKDIR /app
COPY --from=build /app/publish .
USER $APP_UID
ENTRYPOINT ["dotnet", "ChatApp.Background.dll"]
