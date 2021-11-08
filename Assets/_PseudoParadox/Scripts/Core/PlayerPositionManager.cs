using System.Collections.Generic;
using UnityEngine;

namespace _PseudoParadox.Scripts.Core
{
    public class PlayerPositionManager : MonoBehaviour
    {
        public Vector3 startingPosition = new Vector3(0, 0, 0);

        // ReSharper disable once Unity.RedundantHideInInspectorAttribute
        [HideInInspector]
        public Dictionary<string, Vector3> timeToPositionDict = new Dictionary<string, Vector3>();

        public int currentInstance;
        public List<Dictionary<string, Vector3>> timeMachine = new List<Dictionary<string, Vector3>>();

        [HideInInspector]
        public bool shouldResetPosition;

        public void StorePosition(Vector3 position, string currentTime)
        {
            timeToPositionDict[currentTime] = position;
        }

        public void SaveTimeTravel()
        {
            var timeMachineCopy = new Dictionary<string, Vector3>(timeToPositionDict);
            timeMachine.Add(timeMachineCopy);
            timeToPositionDict.Clear();
            currentInstance++;
            shouldResetPosition = true;
        }
    }
}
