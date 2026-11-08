FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY . .
RUN dotnet publish src/Zhike.Api/Zhike.Api.csproj -c Release -o /out/api
RUN dotnet publish src/Zhike.Worker/Zhike.Worker.csproj -c Release -o /out/worker

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS api
WORKDIR /app
COPY --from=build /out/api .
COPY --from=build /src/migrations ./migrations
ENTRYPOINT ["dotnet", "Zhike.Api.dll"]

FROM mcr.microsoft.com/dotnet/runtime:10.0 AS worker
WORKDIR /app
# BackupScheduler invokes pg_dump inside the worker container. Keep the
# client-only package (no PostgreSQL server) in the image so scheduled and
# manual snapshots work in the same isolated network.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
    && install -d /usr/share/postgresql-common/pgdg \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
        | gpg --dearmor -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg \
    && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg] https://apt.postgresql.org/pub/repos/apt noble-pgdg main" \
        > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client-18 \
    && rm -rf /var/lib/apt/lists/* /usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg /etc/apt/sources.list.d/pgdg.list
COPY --from=build /out/worker .
COPY --from=build /src/migrations ./migrations
ENTRYPOINT ["dotnet", "Zhike.Worker.dll"]
