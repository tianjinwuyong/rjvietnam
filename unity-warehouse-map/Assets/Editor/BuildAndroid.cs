using UnityEditor;
using UnityEditor.Build.Reporting;

public static class BuildAndroid
{
    public static void Build()
    {
        var options = new BuildPlayerOptions
        {
            scenes = new[] { "Assets/Scenes/WarehouseMap.unity" },
            locationPathName = "Builds/WmsWarehouseMap.apk",
            target = BuildTarget.Android,
            options = BuildOptions.None,
        };
        var report = BuildPipeline.BuildPlayer(options);
        if (report.summary.result != BuildResult.Succeeded)
            throw new System.Exception("Android build failed: " + report.summary.result);
    }
}
