using System.Collections.Generic;
using UnityEngine;

public class PlayerPositionManager : MonoBehaviour
{
    public Vector3 startingPosition = new Vector3(2, 0, 0);

    [HideInInspector]
    public Dictionary<string, Vector3> timeToPositionDict = new Dictionary<string, Vector3>();

    public int currentInstance = 0;
    public List<Dictionary<string, Vector3>> timeMachine = new List<Dictionary<string, Vector3>>();

    [HideInInspector]
    public bool shouldResetPosition = false;

    public void start()
    {
    }

    public void storePosition(Vector3 position, string currentTime)
    {
        timeToPositionDict[currentTime] = position;
    }


    internal void SaveTimeTravel()
    {
        Dictionary<string, Vector3> timeMachineCopy = new Dictionary<string, Vector3>(timeToPositionDict);
        timeMachine.Add(timeMachineCopy);
        timeToPositionDict.Clear();
        currentInstance++;
        shouldResetPosition = true;
    }
}
