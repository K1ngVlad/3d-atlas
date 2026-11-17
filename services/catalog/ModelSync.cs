using System.Net;
using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;

namespace Catalog;

public sealed class S3Options
{
    public string Endpoint { get; set; } = "http://minio:9000";
    public string AccessKey { get; set; } = "";
    public string SecretKey { get; set; } = "";
    public string Bucket { get; set; } = "models";
}

/// <summary>
/// Syncs models/**/*.glb from the seed into the MinIO bucket (contracts.md, "Начальные данные", step 2):
/// creates the bucket, sets the anonymous read policy via the S3 API, uploads missing objects.
/// </summary>
public sealed class ModelSync(S3Options options, ILogger<ModelSync> log)
{
    public async Task<(int Uploaded, int Skipped)> SyncAsync(string seedPath, CancellationToken ct)
    {
        using var s3 = new AmazonS3Client(
            new BasicAWSCredentials(options.AccessKey, options.SecretKey),
            new AmazonS3Config
            {
                ServiceURL = options.Endpoint,
                ForcePathStyle = true,
                AuthenticationRegion = "us-east-1",
                // MinIO does not need the SDK v4 default checksums; send them only when an operation requires them.
                RequestChecksumCalculation = RequestChecksumCalculation.WHEN_REQUIRED,
                ResponseChecksumValidation = ResponseChecksumValidation.WHEN_REQUIRED,
                Timeout = TimeSpan.FromSeconds(30),
                MaxErrorRetry = 2,
            });

        var bucket = options.Bucket;
        try
        {
            await s3.PutBucketAsync(new PutBucketRequest { BucketName = bucket }, ct);
            log.LogInformation("Created bucket {Bucket}", bucket);
        }
        catch (AmazonS3Exception ex) when (ex.ErrorCode is "BucketAlreadyOwnedByYou" or "BucketAlreadyExists")
        {
        }

        var policy = $$"""
            {"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"AWS":["*"]},"Action":["s3:GetObject"],"Resource":["arn:aws:s3:::{{bucket}}/*"]}]}
            """;
        await s3.PutBucketPolicyAsync(new PutBucketPolicyRequest { BucketName = bucket, Policy = policy }, ct);

        var root = Path.Combine(seedPath, "models");
        int uploaded = 0, skipped = 0;
        foreach (var file in Directory.EnumerateFiles(root, "*.glb", SearchOption.AllDirectories).Order(StringComparer.Ordinal))
        {
            var key = Path.GetRelativePath(root, file).Replace('\\', '/');
            if (await ExistsAsync(s3, bucket, key, ct))
            {
                skipped++;
                continue;
            }
            await s3.PutObjectAsync(new PutObjectRequest
            {
                BucketName = bucket,
                Key = key,
                FilePath = file,
                ContentType = DbSeeder.GlbContentType,
            }, ct);
            uploaded++;
            log.LogInformation("Uploaded {Key} to bucket {Bucket}", key, bucket);
        }
        return (uploaded, skipped);
    }

    private static async Task<bool> ExistsAsync(IAmazonS3 s3, string bucket, string key, CancellationToken ct)
    {
        try
        {
            await s3.GetObjectMetadataAsync(bucket, key, ct);
            return true;
        }
        catch (AmazonS3Exception ex) when (ex.StatusCode == HttpStatusCode.NotFound)
        {
            return false;
        }
    }
}
