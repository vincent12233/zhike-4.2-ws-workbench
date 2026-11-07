FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY . .
RUN dotnet publish src/Zhike.Api/Zhike.Api.csproj -c Release -o /out/api
RUN dotnet publish src/Zhike.Worker/Zhike.Worker.csproj -c Release -o /out/worker

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS api
WORKDIR /app
COPY --from=build /out/api .
ENTRYPOINT ["dotnet", "Zhike.Api.dll"]

FROM mcr.microsoft.com/dotnet/runtime:10.0 AS worker
WORKDIR /app
COPY --from=build /out/worker .
ENTRYPOINT ["dotnet", "Zhike.Worker.dll"]
